# Contributing

Thanks for taking an interest in this project. We want to make contributing to this project as easy and transparent as possible, whether it is:

* Reporting a bug
* Discussing the current state of the code
* Submitting a fix
* Proposing new features
* Becoming a maintainer

## We Develop with GitHub

We use GitHub to host code, track issues and feature requests, and accept pull requests. Discussion and general support are typically handled through Discord.

## We Use [Git Flow](https://www.gitkraken.com/learn/git/git-flow)

<div align="center" style="background:#0d1117"><img src=".github/media/git-flow.svg" width="240" height="365" style="margin-bottom:2ch" /></div>

All code changes happen through pull requests and are the best way to propose changes to the codebase. After cloning, install dependencies and activate the tracked Git hooks:

```sh
npm install
npm run hooks:install
```

The pre-commit hook requires [`gitleaks`](https://github.com/gitleaks/gitleaks). The hooks run the package checks, scan for secrets, and enforce Conventional Commit messages. CI enforces the same commit-message convention for pushed and pull-request commits.

We actively welcome your pull requests:

1. Fork the repo and create your own branch off of the `develop` branch.
2. Name your branch `feat/<name>-<hash>-<desc>` where:
   * `<name>` is your Github username
   * `<hash>` is equal to `openssl rand hex 2`
   * `<desc>` is a short description using hyphen as a separator
3. If you have added code that should be tested, add tests.
4. If you have changed APIs, update the documentation.
5. Run `npm run check` and ensure all checks pass.
6. Verify the extension in a SIXEL-capable tmux client when changing terminal behavior.
7. Issue the pull request!

## Reporting Bugs / Feature Requests

We use Github issues to track public bugs and feature requests. Report a bug/feature by [opening a new issue](/../../issues); it is that easy!

## Contributions & Software Licensing

In short, when you submit code changes, your submissions are understood to be under the same [license](LICENSE) that covers the project itself. If you have a concern about this, please refrain from submitting a PR and contact a maintainer directly.
