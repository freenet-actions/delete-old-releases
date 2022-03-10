const core = require('@actions/core');
const github = require('@actions/github');
const moment = require('moment');

/**
 * Parse the action inputs and the github context to provide a convenient configuration and release-checking object.
 *
 * @return {{owner: string, repo: string, token: string, deleteTags: boolean, dryRun: boolean, checkReleaseName: (function(string)), dateCutoff: moment.Moment}}
 */
module.exports.parseInputs = () => {
  const prefix = core.getInput('prefix');
  const regex = core.getInput('regex');
  const maxAge = core.getInput('max-age');
  const deleteTags = core.getInput('delete-tags') === 'true';
  const keepLatestReleases = core.getInput('keep-latest-releases') === 'true';
  const dryRun = core.getInput('dry-run') === 'true';
  const token = core.getInput('token');
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  if (keepLatestReleases) {
    // Validate regex input
    if (!regex) {
      throw('When using the keep-latest-releases option, a regex input is required.')
    }
    if (regex.indexOf('(?<group>') === -1) {
      throw('When using the keep-latest-releases option, regex needs to contain a capturing group named "group".')
    }
  }

  const dateCutoff = moment().subtract(maxAge);

  let checkReleaseNameAgainstPrefix;
  if (prefix) {
    checkReleaseNameAgainstPrefix = (releaseName) => {
      return releaseName.startsWith(prefix);
    };
  } else {
    checkReleaseNameAgainstPrefix = () => true;
  }

  let checkReleaseNameAgainstRegex;
  let pattern;
  if (regex) {
    pattern = new RegExp(regex);
    checkReleaseNameAgainstRegex = (releaseName) => {
      return pattern.test(releaseName);
    };
  } else {
    checkReleaseNameAgainstRegex = () => true;
  }

  let checkReleaseGroups;
  if (keepLatestReleases) {
    const foundReleaseGroups = [];
    checkReleaseGroups = (releaseName) => {
      const match = releaseName.match(pattern);
      const releaseGroup = match.groups.group;
      if (foundReleaseGroups.includes(releaseGroup)) {
        return true;
      }
      foundReleaseGroups.push(releaseGroup);
      return false;
    }
  } else {
    checkReleaseGroups = () => true;
  }

  const checkReleaseName = (releaseName) =>
      checkReleaseNameAgainstPrefix(releaseName) &&
      checkReleaseNameAgainstRegex(releaseName) &&
      checkReleaseGroups(releaseName);

  return {
    checkReleaseName,
    dateCutoff,
    deleteTags,
    dryRun,
    token,
    owner,
    repo
  };
};

module.exports.fetchAndFilterReleases = async (octokit, inputs) => {
  const releasesToDelete = [];
  const releaseListOptions = {
    owner: inputs.owner,
    repo: inputs.repo,
    page: 0,
    per_page: 100
  }

  let hasMore;
  do {
    // Pages in GitHub API start at 1
    releaseListOptions.page++;
    const response = await octokit.rest.repos.listReleases(releaseListOptions);
    const releases = response.data;
    for(const release of releases) {
      const releaseId = release.id;
      const releaseName = release.name;
      const releaseDate = release.published_at || release.created_at;

      if (!release.draft && inputs.checkReleaseName(releaseName) && inputs.dateCutoff.isAfter(releaseDate)) {
        releasesToDelete.push({
          id: releaseId,
          name: releaseName,
          tag: release.tag_name
        });
      }
    }

    hasMore = releases.length === releaseListOptions.per_page;
  } while(hasMore);

  return releasesToDelete;
}

module.exports.deleteReleases = async (octokit, releases, inputs) => {
  core.info('Removing ' + releases.length + ' releases' + (inputs.deleteTags ? ' with tags' : ''));
  for(let releaseInfo of releases) {
    core.info('Removing release ' + releaseInfo.name);
    if (!inputs.dryRun) {
      await octokit.rest.repos.deleteRelease({
        owner: inputs.owner,
        repo: inputs.repo,
        release_id: releaseInfo.id
      });

      if (inputs.deleteTags) {
        await octokit.rest.repos.deleteRef({
          owner: inputs.owner,
          repo: inputs.repo,
          ref: 'tags/' + releaseInfo.tag
        })
      }
    }
  }
}

module.exports.doTheThing = async () => {
  try {
    const inputs = this.parseInputs();
    core.info('Searching for releases older than ' + inputs.dateCutoff.toISOString());

    const octokit = github.getOctokit(inputs.token);
    const releasesToDelete = await this.fetchAndFilterReleases(octokit, inputs);

    await this.deleteReleases(octokit, releasesToDelete, inputs);
  } catch(error) {
    core.setFailed(error.message);
  }
}
