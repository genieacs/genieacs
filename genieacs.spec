Summary: A TR-069 Auto Configuration Server (ACS)
Name: genieacs
Version: 1.2.7
Release: 1
License: GPL
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

%install

%files
