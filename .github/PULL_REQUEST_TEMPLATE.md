## Summary

Describe the change and its user-visible result.

## Problem and mechanism

Explain the observed problem and the parser, protocol, terminal, or tmux behavior that caused it.

## Implementation

Describe the chosen approach and any compatibility or resource-limit decisions.

## Validation

List the commands and real-terminal checks performed.

```text
npm run check
npm pack --dry-run
```

For rendering changes, include the tested Pi, tmux, outer-terminal, TUI-mode, and `pi-images` output mode combinations.

## References

Link related issues, protocol documentation, or upstream changes.

## Checklist

- [ ] I branched from the current `develop` branch.
- [ ] I kept unrelated changes out of this pull request.
- [ ] I added or updated regression tests for behavior changes.
- [ ] I updated public documentation for changed setup or behavior.
- [ ] `npm run check` passes locally.
- [ ] `npm pack --dry-run` contains only intended release files.
- [ ] gitleaks reports no secrets.
- [ ] I completed the relevant visual tmux tests, or this change does not affect rendering.
- [ ] My commits follow Conventional Commits.

## Additional context

Add migration notes, screenshots without sensitive data, or follow-up work that reviewers need.
