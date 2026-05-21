# Shell / Bash Roadmap

- Roadmap: https://roadmap.sh/shell-bash

## 1. Introduction
- 1.1 What is a Shell
- 1.2 CLI vs GUI
- 1.3 Types of Shells: bash, dash, zsh, fish, ksh, sh
- 1.4 Help Commands (`man`, `help`, `info`, `--help`)

## 2. Basic Commands
- 2.1 Navigating the Filesystem (`cd`, `ls`, `pwd`)
- 2.2 Files and Directories (`mkdir`, `rmdir`, `touch`, `cp`, `mv`, `rm`)
- 2.3 Viewing Files (`cat`, `less`, `head`, `tail`)
- 2.4 Finding Things (`find`, `locate`, `which`, `whereis`)
- 2.5 Searching Content (`grep`, `awk`, `sed`)
- 2.6 Wildcards and Globbing
- 2.7 Echo and Printf

## 3. Editors
- 3.1 vim / nvim
- 3.2 emacs
- 3.3 nano
- 3.4 Basic Editor Ops (create, print, modify)

## 4. Permissions and Users
- 4.1 File Permissions
- 4.2 `chmod`
- 4.3 `chown`
- 4.4 `chgrp`
- 4.5 Users and Groups
- 4.6 `sudo` and Privilege

## 5. Bash Scripting Basics
- 5.1 Bash Script Anatomy (`#!/bin/bash`, shebang)
- 5.2 Comments
- 5.3 Variables
- 5.4 Bash Data Types
- 5.5 Environment vs Shell Variables
- 5.6 Bash Aliases
- 5.7 Exit Codes
- 5.8 Direct Execution vs Sourcing

## 6. Operators and Expressions
- 6.1 Bash Operators
- 6.2 Arithmetic Expansion `$(( ))`
- 6.3 Arithmetic with `expr`, `bc`
- 6.4 Command Substitution `$(...)`
- 6.5 Comparison Operators
- 6.6 File Test Operators
- 6.7 Case Conversion

## 7. Control Flow
- 7.1 Conditionals (`if`, `elif`, `else`)
- 7.2 `case` Statement
- 7.3 Loops: `for`, `while`, `until`
- 7.4 `break` and `continue`
- 7.5 `exit`

## 8. Functions
- 8.1 Defining Functions
- 8.2 Function Scopes
- 8.3 Parameters and Return Values

## 9. Arrays
- 9.1 Indexed Arrays
- 9.2 Associative Arrays

## 10. Input / Output Redirection
- 10.1 Standard Streams (stdin, stdout, stderr)
- 10.2 Redirection (`>`, `>>`, `<`)
- 10.3 Pipes (`|`)
- 10.4 Error Redirection (`2>`, `2>&1`)
- 10.5 `tee`

## 11. Text Processing Tools
- 11.1 `grep`
- 11.2 `awk`
- 11.3 `sed`
- 11.4 `cut`, `paste`
- 11.5 `sort`, `uniq`
- 11.6 `tr`
- 11.7 `wc`
- 11.8 Basic Regex Syntax
- 11.9 Extended Regex

## 12. Process Management
- 12.1 Foreground vs Background (`fg`, `bg`)
- 12.2 `jobs`, `disown`, `nohup`
- 12.3 `ps`, `top`, `htop`
- 12.4 Signals and `kill`
- 12.5 Process Substitution

## 13. Scheduling
- 13.1 `cron` and `crontab`
- 13.2 `at`
- 13.3 `systemd` timers

## 14. Networking from Shell
- 14.1 `curl`
- 14.2 `wget`
- 14.3 `ssh`
- 14.4 `scp`, `rsync`
- 14.5 `netstat`, `ss`
- 14.6 `ping`, `traceroute`, `dig`, `nslookup`

## 15. System Info and Resources
- 15.1 `df`, `du` — Disk Usage
- 15.2 `free` — Memory
- 15.3 `uname`, `uptime`
- 15.4 `lscpu`, `lsblk`, `lsusb`

## 16. Compression and Archiving
- 16.1 `tar`
- 16.2 `gzip` / `gunzip`
- 16.3 `bzip2`, `xz`
- 16.4 `zip` / `unzip`

## 17. Package Managers
- 17.1 `apt` (Debian/Ubuntu)
- 17.2 `dnf` / `yum` (RHEL/Fedora)
- 17.3 `brew` (macOS)
- 17.4 `pacman`, `apk`, etc.

## 18. Error Handling and Debugging
- 18.1 `set -e`, `set -u`, `set -o pipefail`
- 18.2 `trap`
- 18.3 Error Handling Patterns
- 18.4 Error Logging
- 18.5 `bash -n` (syntax check)
- 18.6 `bash -x` and `set -x` (trace)
- 18.7 Bash Debug Tools

## 19. Best Practices
- 19.1 Quoting (single vs double)
- 19.2 ShellCheck Linting
- 19.3 Style Guide
- 19.4 Idempotent Scripts
- 19.5 Defensive Scripting

## 20. Advanced Topics
- 20.1 Heredocs and Herestrings
- 20.2 Subshells
- 20.3 Coprocesses
- 20.4 Trapping Signals
- 20.5 Read-Only Variables
- 20.6 Bash Built-ins vs External Commands
