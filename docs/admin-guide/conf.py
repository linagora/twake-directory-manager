"""Sphinx configuration of the administrator's guide."""

import json
from pathlib import Path

# The guide describes the console of this release: it takes its version from
# the package, so a PDF says which one it was written for.
_package = json.loads(
    (Path(__file__).resolve().parents[2] / "package.json").read_text()
)

project = "Twake Directory Manager"
author = "LINAGORA"
copyright = "LINAGORA"
version = _package["version"]
release = version

language = "en"
root_doc = "index"
exclude_patterns = ["_build"]

html_theme = "alabaster"
html_static_path = ["_static"]
html_logo = "../../public/logo.svg"
html_title = f"{project} — Administrator’s Guide"

latex_engine = "xelatex"
latex_logo = "_static/linagora.png"
latex_documents = [
    (
        root_doc,
        "twake-directory-manager-admin-guide.tex",
        "Twake Directory Manager\\\\Administrator’s Guide",
        author,
        "manual",
    )
]
latex_elements = {
    "papersize": "a4paper",
    "pointsize": "11pt",
}
latex_show_urls = "footnote"
