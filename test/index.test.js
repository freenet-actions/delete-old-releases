const assert = require('assert');
const proxyquire = require('proxyquire').noCallThru();
const sinon = require('sinon');

const core = require('@actions/core');
const moment = require('moment');

// Set up mocking
const coreStub = sinon.stub(core);
const githubStub = {context: {repo: {owner: 'tester', repo: 'testing'}}};
const momentStub = () => moment('2022-01-31T00:00:00Z');
const index = proxyquire('../index.js', {
  '@actions/core': coreStub,
  '@actions/github': githubStub,
  'moment': momentStub
});

describe('Tests', () => {
  beforeEach(() => {
    sinon.reset();
  });

  describe('parseInputs', () => {
    describe('prefix and regex', function() {
      it('should allow all releases when neither prefix nor regex is given', () => {
        const result = index.parseInputs();
        assert.ok(result.checkReleaseName('develop-1'));
        assert.ok(result.checkReleaseName('master-1'));
      });

      it('should check only the prefix when no regex is given', () => {
        coreStub.getInput.withArgs('prefix').returns('develop-');
        const result = index.parseInputs();
        assert.ok(result.checkReleaseName('develop-1'));
        assert.ok(!result.checkReleaseName('master-1'));
      });

      it('should check only the regex when no prefix is given', () => {
        coreStub.getInput.withArgs('regex').returns('^master-\\d+$');
        const result = index.parseInputs();
        assert.ok(!result.checkReleaseName('develop-1'));
        assert.ok(result.checkReleaseName('master-1'));
      });

      it('should check both prefix and regex if both are given', () => {
        coreStub.getInput.withArgs('prefix').returns('develop-');
        coreStub.getInput.withArgs('regex').returns('^.*-\\d$');
        const result = index.parseInputs();
        assert.ok(result.checkReleaseName('develop-1'));
        assert.ok(!result.checkReleaseName('master-1'));
        assert.ok(!result.checkReleaseName('develop-rc1'));
      });
    });

    it('should set dateCutoff to one week in the past', () => {
      coreStub.getInput.withArgs('max-age').returns('P1W');
      const result = index.parseInputs();

      assert.strictEqual(result.dateCutoff.toISOString(), '2022-01-24T00:00:00.000Z');
    });

    describe('delete-tags', () => {
      it('should accept "true" as true', function() {
        coreStub.getInput.withArgs('delete-tags').returns('true');
        assert.ok(index.parseInputs().deleteTags);
      });

      it('should interpret "false" as false', function() {
        coreStub.getInput.withArgs('delete-tags').returns('false');
        assert.ok(!index.parseInputs().deleteTags);
      });

      it('should interpret null as false', function() {
        coreStub.getInput.withArgs('delete-tags').returns(null);
        assert.ok(!index.parseInputs().deleteTags);
      });

      it('should interpret no value as false', function() {
        assert.ok(!index.parseInputs().deleteTags);
      });
    });

    describe('keep-latest-releases', () => {
      it('should check that regex is set when set to "true"', function() {
        coreStub.getInput.withArgs('keep-latest-releases').returns('true');
        let exceptionThrown = false;
        try {
          index.parseInputs();
        } catch(_) {
          exceptionThrown = true;
        }
        assert.ok(exceptionThrown, 'Exception was thrown');
      });

      it('should check that regex contains the capturing group when set to "true"', function() {
        coreStub.getInput.withArgs('regex').returns('.*-\\d+$');
        coreStub.getInput.withArgs('keep-latest-releases').returns('true');
        let exceptionThrown = false;
        try {
          index.parseInputs();
        } catch(_) {
          exceptionThrown = true;
        }
        assert.ok(exceptionThrown, 'Exception was thrown');
      });

      it('should check the release group when set to "true"', function() {
        coreStub.getInput.withArgs('regex').returns('^(?<group>.*)-\\d+$');
        coreStub.getInput.withArgs('keep-latest-releases').returns('true');
        const result = index.parseInputs();
        assert.ok(!result.checkReleaseName('develop-2'));
        assert.ok(result.checkReleaseName('develop-1'));
      });

      it('should ignore the release group when set to "false"', function() {
        coreStub.getInput.withArgs('prefix').returns('develop-');
        coreStub.getInput.withArgs('keep-latest-releases').returns('false');
        const result = index.parseInputs();
        assert.ok(result.checkReleaseName('develop-2'));
        assert.ok(result.checkReleaseName('develop-1'));
      });
    });

    it('should export owner and repo as-is', function() {
      const result = index.parseInputs();
      assert.strictEqual(result.owner, 'tester');
      assert.strictEqual(result.repo, 'testing');
    });

    describe('dry-run', () => {
      it('should accept "true" as true', function() {
        coreStub.getInput.withArgs('dry-run').returns('true');
        assert.ok(index.parseInputs().dryRun);
      });

      it('should interpret "false" as false', function() {
        coreStub.getInput.withArgs('dry-run').returns('false');
        assert.ok(!index.parseInputs().dryRun);
      });

      it('should interpret null as false', function() {
        coreStub.getInput.withArgs('dry-run').returns(null);
        assert.ok(!index.parseInputs().dryRun);
      });

      it('should interpret no value as false', function() {
        assert.ok(!index.parseInputs().dryRun);
      });
    });
  });

  describe('fetchAndFilterReleases', function() {
    it('should pass the inputs to the listReleases call', async function() {
      const inputs = {owner: 'tester', repo: 'testing', dateCutoff: momentStub(), checkReleaseName: () => true};
      const listReleasesStub = sinon.stub();
      const octokit = {rest: {repos: {listReleases: listReleasesStub}}}
      listReleasesStub.returns({data: []});

      await index.fetchAndFilterReleases(octokit, inputs);

      assert.ok(listReleasesStub.calledWith(sinon.match({owner: 'tester', repo: 'testing', page: 1, pageSize: 100})));
    });

    it('should load and filter the releases', async function() {
      const inputs = {owner: 'tester', repo: 'testing', dateCutoff: momentStub(), checkReleaseName: () => true};
      const listReleasesStub = sinon.stub();
      const octokit = {rest: {repos: {listReleases: listReleasesStub}}}
      listReleasesStub.returns(require('./releases.json'));

      const result = await index.fetchAndFilterReleases(octokit, inputs);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].id, 3);
      assert.strictEqual(result[0].name, 'old-release-without-published-date');
      assert.strictEqual(result[0].tag, 'release-3');
      assert.strictEqual(result[1].id, 4);
      assert.strictEqual(result[1].name, 'old-release-with-published-date');
      assert.strictEqual(result[1].tag, 'release-4');
    });

    it('should use pagination to fetch releases', async function() {
      const inputs = {owner: 'tester', repo: 'testing', dateCutoff: momentStub(), checkReleaseName: () => true};
      const listReleasesStub = sinon.stub();
      const octokit = {rest: {repos: {listReleases: listReleasesStub}}};
      const listReleasesResults = [[], [], []];
      for(let releaseId = 0; releaseId < 261; releaseId++) {
        listReleasesResults[Math.floor(releaseId / 100)].push({
          id: releaseId,
          name: 'release-' + releaseId,
          tag: 'release-' + releaseId,
          draft: false,
          published_at: '2022-01-01T00:00:00Z'
        });
      }
      for(let i = 0; i < 3; i++) {
        listReleasesStub.withArgs(sinon.match({page: i + 1})).returns({data: listReleasesResults[i]});
      }

      const result = await index.fetchAndFilterReleases(octokit, inputs);

      assert.strictEqual(261, result.length);
      // sinon spies don't clone the arguments during the call.
      // Because we mutate the releaseListOptions object in fetchAndFilterReleases, we cannot sensibly check the page argument with stub.calledWith
      // Instead, we check a few of the returned releases to make sure that the page size has been incremented between calls.
      assert.strictEqual(0, result[0].id);
      assert.strictEqual(100, result[100].id);
      assert.strictEqual(200, result[200].id);
      assert.strictEqual(260, result[260].id);
    });
  });

  describe('deleteReleases', function() {
    it('should delete only the releases when deleteTags is false', async function() {
      const inputs = {owner: 'tester', repo: 'testing', deleteTags: false};
      const deleteReleaseStub = sinon.stub();
      const deleteRefStub = sinon.stub();
      const octokit = {rest: {repos: {deleteRelease: deleteReleaseStub, deleteRef: deleteRefStub}}}
      const releases = [
        {id: 1},
        {id: 2}
      ];

      await index.deleteReleases(octokit, releases, inputs);

      assert.strictEqual(deleteReleaseStub.callCount, 2);
      assert.ok(deleteReleaseStub.firstCall.calledWith({owner: 'tester', repo: 'testing', release_id: 1}));
      assert.ok(deleteReleaseStub.secondCall.calledWith({owner: 'tester', repo: 'testing', release_id: 2}));
      assert.ok(deleteRefStub.notCalled);
    });

    it('should delete releases and tags when deleteTags is true', async function() {
      const inputs = {owner: 'tester', repo: 'testing', deleteTags: true};
      const deleteReleaseStub = sinon.stub();
      const deleteRefStub = sinon.stub();
      const octokit = {rest: {repos: {deleteRelease: deleteReleaseStub, deleteRef: deleteRefStub}}}
      const releases = [
        {id: 1, tag: 'develop-1'},
        {id: 2, tag: 'develop-2'}
      ];

      await index.deleteReleases(octokit, releases, inputs);

      assert.strictEqual(deleteReleaseStub.callCount, 2);
      assert.ok(deleteReleaseStub.firstCall.calledWith({owner: 'tester', repo: 'testing', release_id: 1}));
      assert.ok(deleteReleaseStub.secondCall.calledWith({owner: 'tester', repo: 'testing', release_id: 2}));
      assert.strictEqual(deleteRefStub.callCount, 2);
      assert.ok(deleteRefStub.firstCall.calledWith({owner: 'tester', repo: 'testing', ref: 'tags/develop-1'}));
      assert.ok(deleteRefStub.secondCall.calledWith({owner: 'tester', repo: 'testing', ref: 'tags/develop-2'}));
    });

    it('should not delete releases or tags when dry-run is enabled', async function() {
      const inputs = {owner: 'tester', repo: 'testing', deleteTags: true, dryRun: true};
      const deleteReleaseStub = sinon.stub();
      const deleteRefStub = sinon.stub();
      const octokit = {rest: {repos: {deleteRelease: deleteReleaseStub, deleteRef: deleteRefStub}}}
      const releases = [
        {id: 1, tag: 'develop-1'},
        {id: 2, tag: 'develop-2'}
      ];

      await index.deleteReleases(octokit, releases, inputs);

      assert.ok(deleteReleaseStub.notCalled);
      assert.ok(deleteRefStub.notCalled);
    });
  });

  it('should not keep old releases if there is a recent release for the group', async function() {
    coreStub.getInput.withArgs('regex').returns('^(?<group>.*)-\\d+$');
    coreStub.getInput.withArgs('max-age').returns('P1W');
    coreStub.getInput.withArgs('keep-latest-releases').returns('true');
    const listReleasesStub = sinon.stub();
    const octokit = {rest: {repos: {listReleases: listReleasesStub}}}
    listReleasesStub.returns({
      data: [
        {
          id: 2,
          name: 'develop-2',
          draft: false,
          published_at: '2022-02-25T00:00:00Z'
        },
        {
          id: 1,
          name: 'develop-1',
          draft: false,
          published_at: '2022-01-23T00:00:00Z'
        }
      ]
    });

    const inputs = index.parseInputs();
    const result = await index.fetchAndFilterReleases(octokit, inputs);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(1, result[0].id);
  });
});
