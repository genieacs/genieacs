#!/bin/bash

cd "$(dirname "$0")"

declare -A FONTS=(
  [InterVariable]=https://rsms.me/inter/font-files/InterVariable.woff2
  [InterVariable-Italic]=https://rsms.me/inter/font-files/InterVariable-Italic.woff2
  [RobotoMono]=https://raw.githubusercontent.com/googlefonts/RobotoMono/main/fonts/variable/RobotoMono%5Bwght%5D.ttf
)

for name in "${!FONTS[@]}"
do
  url="${FONTS[$name]}"
  echo "Downloading $url"
  TMP=$(mktemp)
  curl "$url" -s --output "$TMP"
  pyftsubset "$TMP" --output-file="../ui/css/$name.woff2" --flavor=woff2 --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" --layout-features+="tnum"
done
