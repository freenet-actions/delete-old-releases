// run is an async method. To await it, we need to wrap the call in another async method.
(async () => {
  await require('./index').run();
})();
