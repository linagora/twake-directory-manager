# The OpenLDAP of the QA stack (#399), built from the upstream release: a 2.6
# or a 2.7 is a build argument away, and the Debian base keeps its security
# fixes on every rebuild, where the frozen bitnamilegacy image kept none.
#
#   scripts/qa-environment/build.sh                              # OPENLDAP_VERSION below
#   QA_OPENLDAP_VERSION=2.7.2 scripts/qa-environment/build.sh    # another release
#
# The image holds slapd, the client tools and the overlays as modules, and an
# entrypoint that writes a bare cn=config on first start: the schemas,
# overlays and data are start.sh's, as for the osixia 2.4 image (#118).
ARG DEBIAN_IMAGE=debian:trixie-slim

FROM ${DEBIAN_IMAGE} AS build
ARG OPENLDAP_VERSION=2.6.16
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends \
    build-essential ca-certificates curl file gpg gpgv groff-base libltdl-dev libsasl2-dev libssl-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Checked against the OpenLDAP Project's release key, kept here
# (openldap-release.asc, 3CE2 69B5 398B C8B7 8564  5E98 7F67 D5FD 1CE1 CBCE):
# what the server answers proves nothing by itself.
COPY openldap-release.asc /tmp/openldap-release.asc
RUN release="https://www.openldap.org/software/download/OpenLDAP/openldap-release/openldap-${OPENLDAP_VERSION}.tgz" \
  && curl -fsSL --proto '=https' -o openldap.tgz "$release" \
  && curl -fsSL --proto '=https' -o openldap.tgz.asc "$release.asc" \
  && gpg --dearmor < /tmp/openldap-release.asc > /tmp/openldap-release.gpg \
  && gpgv --keyring /tmp/openldap-release.gpg openldap.tgz.asc openldap.tgz \
  && tar -xzf openldap.tgz --strip-components=1 \
  && rm openldap.tgz openldap.tgz.asc
RUN ./configure --prefix=/opt/openldap --sysconfdir=/etc --localstatedir=/var \
    --enable-slapd --enable-modules --enable-overlays=mod --enable-mdb \
    --with-tls=openssl --with-cyrus-sasl --disable-static \
  && make -j"$(nproc)" depend \
  && make -j"$(nproc)" \
  && make install DESTDIR=/out \
  && rm -rf /out/opt/openldap/share/man /out/opt/openldap/include /out/var

FROM ${DEBIAN_IMAGE}
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends ca-certificates libltdl7 libsasl2-2 libssl3t64 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
ENV PATH=/opt/openldap/bin:/opt/openldap/sbin:$PATH
EXPOSE 389
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
