Summary: A TR-069 Auto Configuration Server (ACS)
Name: genieacs
Version: 1.2.7
Release: 1%{?dist}
License: AGPL-3.0
Group: Applications/Productivity
URL: https://github.com/genieacs/genieacs
Vendor: GenieACS Inc.
Packager: Zaid Abdulla <zaid@genieacs.com>

Source0: https://github.com/genieacs/genieacs/archive/refs/tags/v%{version}.tar.gz
BuildArch: noarch
BuildRequires: nodejs

Requires: nodejs, mongodb-org

%description
A fast and lightweight TR-069 Auto Configuration Server (ACS)

%prep
%setup -q

%build
npm install
npm run build

cat > genieacs.env <<EOF
GENIEACS_CWMP_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-cwmp-access.log
GENIEACS_NBI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-nbi-access.log
GENIEACS_FS_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-fs-access.log
GENIEACS_UI_ACCESS_LOG_FILE=/var/log/genieacs/genieacs-ui-access.log
GENIEACS_DEBUG_FILE=/var/log/genieacs/genieacs-debug.yaml
NODE_OPTIONS=--enable-source-maps
GENIEACS_EXT_DIR=/opt/genieacs/ext
GENIEACS_UI_JWT_SECRET=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
EOF

cat > genieacs-cwmp.service <<EOF
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

cat > genieacs-nbi.service <<EOF
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

cat > genieacs-fs.service <<EOF
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

cat > genieacs-ui.service <<EOF
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

cat > genieacs.rotate <<EOF
/var/log/genieacs/*.log /var/log/genieacs/*.yaml {
    daily
    rotate 30
    compress
    delaycompress
    dateext
}
EOF

%install

mkdir -p %{buildroot}/opt/genieacs/ext
mkdir -p %{buildroot}%{_bindir}
mkdir -p %{buildroot}/usr/lib/systemd/system/
mkdir -p %{buildroot}/var/log/genieacs/
mkdir -p %{buildroot}/etc/logrotate.d/

touch %{buildroot}/var/log/genieacs/genieacs-cwmp-access.log
touch %{buildroot}/var/log/genieacs/genieacs-nbi-access.log
touch %{buildroot}/var/log/genieacs/genieacs-fs-access.log
touch %{buildroot}/var/log/genieacs/genieacs-ui-access.log
touch %{buildroot}/var/log/genieacs/genieacs-debug.yaml

install -m 600 genieacs.env %{buildroot}/opt/genieacs/genieacs.env
install -m 600 genieacs.rotate %{buildroot}/etc/logrotate.d/genieacs

install -m 755 dist/bin/genieacs-cwmp %{buildroot}%{_bindir}/genieacs-cwmp
install -m 755 dist/bin/genieacs-ext %{buildroot}%{_bindir}/genieacs-ext
install -m 755 dist/bin/genieacs-fs %{buildroot}%{_bindir}/genieacs-fs
install -m 755 dist/bin/genieacs-nbi %{buildroot}%{_bindir}/genieacs-nbi
install -m 755 dist/bin/genieacs-ui %{buildroot}%{_bindir}/genieacs-ui

#install %{name}.service %{buildroot}%{_unitdir}/%{name}.service

%files
%defattr(666,genieacs,genieacs,644)

%dir /opt/genieacs/
%dir /opt/genieacs/ext

#%attr(-, root, root) %{_unitdir}/%{name}.service
%attr(755,genieacs,genieacs) %{_bindir}/genieacs-cwmp
%attr(755,genieacs,genieacs) %{_bindir}/genieacs-ext
%attr(755,genieacs,genieacs) %{_bindir}/genieacs-fs
%attr(755,genieacs,genieacs) %{_bindir}/genieacs-nbi
%attr(755,genieacs,genieacs) %{_bindir}/genieacs-ui

%config %attr(600,genieacs,genieacs) /opt/genieacs/genieacs.env
%config %attr(600,genieacs,genieacs) /etc/logrotate.d/genieacs
%config %attr(600,genieacs,genieacs) /var/log/genieacs/genieacs-debug.yaml

%attr(755,genieacs,genieacs) /var/log/genieacs/genieacs-cwmp-access.log
%attr(755,genieacs,genieacs) /var/log/genieacs/genieacs-fs-access.log
%attr(755,genieacs,genieacs) /var/log/genieacs/genieacs-nbi-access.log
%attr(755,genieacs,genieacs) /var/log/genieacs/genieacs-ui-access.log

%pre
if [ $1 == 1 ];then
   /usr/bin/getent group genieacs >/dev/null || /usr/sbin/groupadd -g 128 -r genieacs
   /usr/bin/getent passwd genieacs >/dev/null || /usr/sbin/useradd -c "Tollring" -u 128 -g 128 -r -d /opt/genieacs genieacs
   /usr/bin/getent passwd genieacs >/dev/null || chown genieacs:genieacs /var/log/genieacs
fi

