(function () {
  const hmr = document.createElement("script");
  hmr.src = "/modules/foundryvtt-node-hacker/@vite/client";
  hmr.type = "module";
  document.head.prepend(hmr);

  const lib = document.createElement("script");
  lib.src = "/modules/foundryvtt-node-hacker/src/node-hacker.ts";
  lib.type = "module";
  document.head.appendChild(lib);
})();
