// Start the console in the page the image serves. A file of its own rather
// than a <script> inside index.html: the Content-Security-Policy the image
// sends allows no inline script, so that a value written into the page can
// never run.
import { DirectoryConsole } from './twake-directory-manager.esm.js';

// Everything the console shows — entities, attributes, labels, patterns,
// lifecycle states — comes from the server's own configuration, so this
// page has nothing to declare.
const console_ = new DirectoryConsole({
  containerId: 'directory-console',
});

console_.init().catch(error => {
  document.getElementById('directory-console').textContent =
    `Cannot reach the API: ${error.message}`;
});
