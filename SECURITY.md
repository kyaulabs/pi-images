# Security policy

## Supported versions

Before the first stable release, security fixes apply to the current `0.1.x` line.

| Version | Supported |
| --- | --- |
| `0.1.x` | Yes |
| Earlier versions | No |

## Report a vulnerability

Send security reports to [git@kyaulabs.com](mailto:git@kyaulabs.com). Do not open a public issue for an unpatched vulnerability.

Include:

- the affected version or commit;
- the Pi, Node.js, tmux, and outer-terminal versions;
- the active mode reported by `/images-status`;
- steps or a minimal input that reproduces the problem;
- the expected security impact; and
- any known workaround.

Remove credentials, private images, session content, and unrelated terminal logs. If the report requires sensitive material, ask the maintainer how to transfer it.

The lead maintainer will acknowledge the report within 48 hours and provide the next step or request more information within another 48 hours.

Report vulnerabilities in a third-party dependency to that dependency's maintainers. Contact this project as well when the dependency issue affects `pi-images` users.

## Security boundaries

`pi-images` runs in the Pi process with the user's permissions. While active, it intercepts terminal writes, decodes untrusted image payloads in SIXEL mode, and sends graphics commands to tmux or the outer terminal. Relevant reports include:

- a Kitty payload escaping the streaming parser and reaching the terminal as raw text;
- malformed image data causing unbounded memory or CPU use;
- cache or size limits that can be bypassed;
- terminal control injection through parsed Kitty fields;
- image data reaching an unintended terminal, log, or session artifact; and
- package or TPM installation behavior that executes unintended commands.

The extension does not change which image content Pi sends to the model. It only changes terminal output. Kitty-placeholder mode sends encoded image bytes to the outer terminal through tmux passthrough. SIXEL mode decodes and converts those bytes in the Pi process.

## Disclosure process

After receiving a report, the maintainer will:

1. reproduce the issue and identify affected versions;
2. inspect related parser and protocol paths;
3. prepare and test a fix for supported versions;
4. coordinate a release and disclosure date with the reporter when practical; and
5. publish the fix and relevant upgrade guidance.

Submit improvements to this policy through a pull request when they do not disclose an active vulnerability.
