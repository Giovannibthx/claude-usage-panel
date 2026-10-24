#!/usr/bin/env bash
# Fail when a private name - an internal project, a customer, a work address -
# is about to land in this PUBLIC repository.
#
#   scripts/check-private-names.sh FILE...           files (the pre-commit hook)
#   scripts/check-private-names.sh --message-file F  a commit message (commit-msg hook)
#   scripts/check-private-names.sh --all             tree + every commit's diff,
#                                                    message, author and committer (CI)
#
# The names themselves can not live here: a list of customers committed to a
# public repo would be the very leak it guards against. They live outside it,
# one extended regex per line (# comments, blank lines ignored), matched
# case-insensitively:
#
#   $CUP_PRIVATE_NAMES_FILE, else ${XDG_CONFIG_HOME:-~/.config}/claude-usage-panel/private-names.txt
#   $CUP_PRIVATE_MAILMAP_FILE, else mailmap next to it (--all: identities)
#
# CI writes those files from the PRIVATE_NAMES and PRIVATE_MAILMAP secrets.
# With no list the check is skipped - a contributor has none - unless
# CUP_PRIVATE_NAMES_REQUIRED=1, which CI sets on this repository so a missing
# secret fails instead of passing.
#
# A finding prints WHERE (file:line, commit id), never WHAT: CI logs are public.
set -euo pipefail

list="${CUP_PRIVATE_NAMES_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/claude-usage-panel/private-names.txt}"
# Same place, same reason: old work addresses mapped to the person's own
# (git mailmap format), read by --all only. Absent = nothing mapped.
mailmap="${CUP_PRIVATE_MAILMAP_FILE:-$(dirname "$list")/mailmap}"
if [ ! -s "$list" ]; then
    if [ "${CUP_PRIVATE_NAMES_REQUIRED:-0}" = 1 ]; then
        echo "private-names: no list at $list - required here (set the PRIVATE_NAMES secret)" >&2
        exit 1
    fi
    echo "private-names: no list at $list - skipped (only the maintainer has one)"
    exit 0
fi

# One alternation of every non-comment line.
pattern="$(grep -v -E '^[[:space:]]*(#|$)' "$list" | paste -sd'|' -)"
[ -n "$pattern" ] || {
    echo "private-names: $list has no patterns" >&2
    exit 1
}

found=0
hit() {
    echo "private-names: $1"
    found=1
}

# Files: report file:line only.
scan_files() {
    local f n
    for f in "$@"; do
        [ -f "$f" ] || continue
        while read -r n; do
            hit "$f:$n contains a private name"
        done < <(grep -I -n -i -E "$pattern" "$f" 2>/dev/null | cut -d: -f1 || true)
    done
}

case "${1:-}" in
    --message-file)
        [ -f "${2:-}" ] || {
            echo "usage: $0 --message-file FILE" >&2
            exit 2
        }
        # comment lines are git's own template, not the message
        if grep -v '^#' "$2" | grep -q -i -E "$pattern"; then
            hit "the commit message contains a private name"
        fi
        ;;
    --all)
        # not mapfile: bash 3.2 (macOS /bin/bash) has none
        while IFS= read -r f; do
            scan_files "$f"
        done < <(git ls-files)
        # History already published cannot be unpublished without a rewrite:
        # each such commit is DECLARED by full id and kind (diff | message)
        # with its reason, one per line. An entry that matches nothing fails.
        history="${CUP_PRIVATE_NAMES_HISTORY:-$(git rev-parse --show-toplevel)/.github/private-names-history}"
        declared="" used=" "
        if [ -f "$history" ]; then
            n=0
            while IFS= read -r line || [ -n "$line" ]; do
                n=$((n + 1))
                case "$line" in '' | '#'*) continue ;; esac
                read -r h_sha h_kind h_reason <<<"$line"
                if ! printf '%s' "$h_sha" | grep -qE '^[0-9a-f]{40}$' ||
                    { [ "$h_kind" != diff ] && [ "$h_kind" != message ]; } || [ -z "$h_reason" ]; then
                    hit "private-names-history:$n: expected <full commit id> <diff|message> <reason>"
                    continue
                fi
                declared="$declared$h_kind $h_sha $n
"
            done <"$history"
        fi
        # is_declared KIND FULLSHA: the entry's line number, or nothing
        is_declared() {
            printf '%s' "$declared" | awk -v k="$1" -v s="$2" '$1 == k && $2 == s { print $3; exit }'
        }
        historic() { # KIND LABEL: hits from `git log ... --format='%H %h'` on stdin
            local full short at
            while read -r full short; do
                at="$(is_declared "$1" "$full")"
                if [ -n "$at" ]; then
                    used="$used$at "
                else
                    hit "commit $short: its $1 contains a private name"
                fi
            done
        }
        # every commit whose diff adds or removes a match
        historic diff < <(git log --all -i -G "$pattern" --format='%H %h')
        historic message < <(git log --all -i -E --grep="$pattern" --format='%H %h')
        while read -r _ _ at; do
            case "$used" in *" $at "*) ;; *) hit "private-names-history:$at matches nothing - delete it" ;; esac
        done < <(printf '%s' "$declared")
        # the identity through the PRIVATE mailmap (%aN/%aE): an old work
        # address mapped there to the person's own is declared. Never a tracked
        # .mailmap - it would have to spell out the very name it maps away.
        while read -r sha who; do
            if printf '%s\n' "$who" | grep -q -i -E "$pattern"; then
                hit "commit $sha: its author or committer contains a private name"
            fi
        done < <(git -c mailmap.file="$mailmap" log --all --format='%h %aN <%aE> %cN <%cE>')
        ;;
    -h | --help)
        sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
        exit 0
        ;;
    *)
        scan_files "$@"
        ;;
esac

if [ "$found" = 1 ]; then
    echo "private-names: replace them with neutral placeholders (my-app, example.com, ...)" >&2
    exit 1
fi
