#! /bin/sh

cd "$(dirname "$0")"

FILES=`ls ../docs/*.rst ../docs/*.js ../*.md`

for FILE in $FILES
do
    echo $FILE
    cat $FILE | aspell list --lang=en --add-extra-dicts=./spellcheck-dict.pws --ignore 2
    echo
done
