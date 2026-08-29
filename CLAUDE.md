@AGENTS.md

Do not preview changes unless explicitly asked to.

Do not commit, push, or create branches. Leave finished work in the working
tree and say what changed — the author handles staging, committing and
pushing, so they can check the behaviour locally first. Run the checks (lint,
type-check, tests, build) as usual before handing work over.

Exception worth raising, not assuming: in a remote session (Claude Code on the
web) the working tree lives in a container, not on the author's machine, so
uncommitted work never reaches them and is lost when the container is
reclaimed. There, finish the work, say it is ready, and ask before pushing
anything.
