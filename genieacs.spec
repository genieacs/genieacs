Summary: A TR-069 Auto Configuration Server (ACS)
Name: genieacs
Version: 1.2.7
Release: 1%{?dist}
License: AGPL-3.0
Group: Applications/Productivity
URL: https://github.com/genieacs/genieacs
Vendor: GenieACS Inc.
Packager: Zaid Abdulla <zaid@genieacs.com>

Source0: https://registry.npmjs.org/%{name}/-/%{name}-%{version}.tgz
BuildArch: noarch
BuildRequires: nodejs

Requires: mongodb-org

%description
A fast and lightweight TR-069 Auto Configuration Server (ACS)

%prep

%setup -q -n package
mkdir lib

#npm install
#pushd node_modules

#%{buildroot}%{_prefix}/lib/node_modules/%{name}
#popd

%build
#npm run build

cat > lib/genieacs.env <<EOF
GENIEACS_CWMP_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-cwmp-access.log
GENIEACS_NBI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-nbi-access.log
GENIEACS_FS_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-fs-access.log
GENIEACS_UI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-ui-access.log
GENIEACS_DEBUG_FILE=/var/log/genieacs/genieacs-debug.yaml
NODE_OPTIONS=--enable-source-maps
GENIEACS_EXT_DIR=/opt/genieacs/ext
GENIEACS_UI_JWT_SECRET=secret
EOF

cat > lib/genieacs-cwmp.service <<EOF
[Unit]
Description=GenieACS CWMP
After=network.target

[Service]
User=genieacs
EnvironmentFile=/opt/genieacs/genieacs.env
ExecStart=/usr/bin/genieacs-cwmp

[Install]
WantedBy=default.target
EOF

cat > lib/genieacs-nbi.service <<EOF
[Unit]
Description=GenieACS NBI
After=network.target

[Service]
User=genieacs
EnvironmentFile=/opt/genieacs/genieacs.env
ExecStart=/usr/bin/genieacs-nbi

[Install]
WantedBy=default.target
EOF

cat > lib/genieacs-fs.service <<EOF
[Unit]
Description=GenieACS FS
After=network.target

[Service]
User=genieacs
EnvironmentFile=/opt/genieacs/genieacs.env
ExecStart=/usr/bin/genieacs-fs

[Install]
WantedBy=default.target
EOF

cat > lib/genieacs-ui.service <<EOF
[Unit]
Description=GenieACS UI
After=network.target

[Service]
User=genieacs
EnvironmentFile=/opt/genieacs/genieacs.env
ExecStart=/usr/bin/genieacs-ui

[Install]
WantedBy=default.target
EOF

cat > lib/genieacs.rotate <<EOF
/var/log/genieacs/*.log /var/log/genieacs/*.yaml {
    daily
    rotate 30
    compress
    delaycompress
    dateext
}
EOF

%install

mkdir -p %{buildroot}%{_bindir}
mkdir -p %{buildroot}/usr/lib/systemd/system/
mkdir -p %{buildroot}/etc/logrotate.d/

mkdir -p %{buildroot}/opt/genieacs/ext
mkdir -p %{buildroot}/var/log/genieacs/

touch %{buildroot}/var/log/genieacs/genieacs-cwmp-access.log
touch %{buildroot}/var/log/genieacs/genieacs-nbi-access.log
touch %{buildroot}/var/log/genieacs/genieacs-fs-access.log
touch %{buildroot}/var/log/genieacs/genieacs-ui-access.log
touch %{buildroot}/var/log/genieacs/genieacs-debug.yaml

install -m 600 lib/genieacs.env %{buildroot}/opt/genieacs/genieacs.env
install -m 600 lib/genieacs.rotate %{buildroot}/etc/logrotate.d/genieacs

install lib/genieacs-cwmp.service %{buildroot}%{_unitdir}/genieacs-cwmp.service
install lib/genieacs-fs.service %{buildroot}%{_unitdir}/genieacs-fs.service
install lib/genieacs-nbi.service %{buildroot}%{_unitdir}/genieacs-nbi.service
install lib/genieacs-ui.service %{buildroot}%{_unitdir}/genieacs-ui.service

%files
%defattr(-,genieacs,genieacs,-)
%doc README.md
%license LICENSE

%dir /opt/genieacs/
%dir /opt/genieacs/ext
%dir /var/log/genieacs

%{_unitdir}/genieacs-cwmp.service
%{_unitdir}/genieacs-fs.service
%{_unitdir}/genieacs-nbi.service
%{_unitdir}/genieacs-ui.service

/opt/genieacs/genieacs.env
/etc/logrotate.d/genieacs
/var/log/genieacs/genieacs-debug.yaml

/var/log/genieacs/genieacs-cwmp-access.log
/var/log/genieacs/genieacs-nbi-access.log
/var/log/genieacs/genieacs-fs-access.log
/var/log/genieacs/genieacs-ui-access.log
/var/log/genieacs/genieacs-debug.yaml

%pre

npm install -g %{name}@%{version} --quiet --no-progress> /dev/null

if [ $1 == 1 ];then
   /usr/bin/getent group genieacs >/dev/null || /usr/sbin/groupadd -g 128 -r genieacs
   /usr/bin/getent passwd genieacs >/dev/null || /usr/sbin/useradd -c "Tollring" -u 128 -g 128 -r -d /opt/genieacs genieacs
   /usr/bin/getent passwd genieacs >/dev/null || chown genieacs:genieacs /var/log/genieacs
#   %{_bindir}/genieacs-ui --ui-jwt-secret $(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
fi

%post

%changelog
