const core = require('@actions/core');
const github = require('@actions/github');
const moment = require('moment');

/**
 * Parse and validate the action inputs, instantiate the octokit client, fetch the old releases and delete them. Fail the action on error.
 * @return {Promise<void>}
 */
module.exports.run = async () => {
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

/**
 * Parse the action inputs and the GitHub context to provide a convenient configuration and release-checking object.
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

  // Create a method to check the release name against prefix, regex and keep-old-release inputs.
  let pattern = new RegExp(regex);
  const foundReleaseGroups = [];
  const checkReleaseName = (releaseName) => {
    // Check prefix
    if (prefix && !releaseName.startsWith(prefix)) {
      return false;
    }

    // Check regex
    if (regex) {
      if (!pattern.test(releaseName)) {
        return false;
      }

      // Check if we have already found a release of the captured group
      if (keepLatestReleases) {
        const releaseGroup = releaseName.match(pattern).groups.group;
        if (!foundReleaseGroups.includes(releaseGroup)) {
          foundReleaseGroups.push(releaseGroup);
          return false;
        }
      }
    }

    return true;
  };

  return {
    checkReleaseName,
    dateCutoff,
    deleteTags,
    dryRun,
    token,
    owner,
    repo
  };
}
;

/**
 * Fetch the repositories releases using pagination.
 * @param octokit the authenticated rest client
 * @param inputs the inputs as created by {@link parseInputs}
 * @return {Promise<{id, name, tag}[]>} an array of releases that match the inputs and should be deleted.
 */
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

      // Draft releases are always ignored
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

/**
 * Delete the releases and, if the delete-tags input is set, the associated tags, unless dry-run is enabled.
 * @param octokit the authenticated octokit client
 * @param releases the list of releases to delete as created by {@link fetchAndFilterReleases}
 * @param inputs the inputs as created by {@link parseInputs}
 * @return {Promise<void>}
 */
module.exports.deleteReleases = async (octokit, releases, inputs) => {
  core.info('Removing ' + releases.length + ' releases' + (inputs.deleteTags ? ' with tags' : '') + (inputs.dryRun ? ' (but not actually)' : ''));
  for(let releaseInfo of releases) {
    core.info('Removing release ' + releaseInfo.name);
    if (!inputs.dryRun) {
      await octokit.rest.repos.deleteRelease({
        owner: inputs.owner,
        repo: inputs.repo,
        release_id: releaseInfo.id
      });

      if (inputs.deleteTags) {
        await octokit.rest.git.deleteRef({
          owner: inputs.owner,
          repo: inputs.repo,
          ref: 'tags/' + releaseInfo.tag
        })
      }
    }
  }
}
