# Build the administrator's guide.
#
#   make html       HTML pages in _build/html
#   make latexpdf   the PDF in _build/latex, with a local LaTeX (xelatex)
#   make pdf        the same PDF, built in Sphinx's LaTeX image: only Docker needed

SPHINXBUILD ?= sphinx-build
SOURCEDIR    = .
BUILDDIR     = _build
SPHINX_IMAGE ?= sphinxdoc/sphinx-latexpdf

.PHONY: help clean pdf Makefile

help:
	@$(SPHINXBUILD) -M help "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS)

# conf.py reads the version from the repository's package.json, so the whole
# repository is mounted, not this directory alone.
pdf:
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp \
		-v "$(CURDIR)/../..:/repo" -w /repo/docs/admin-guide \
		$(SPHINX_IMAGE) make latexpdf
	@ls $(BUILDDIR)/latex/*.pdf

clean:
	rm -rf $(BUILDDIR)

%: Makefile
	@$(SPHINXBUILD) -M $@ "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS)
