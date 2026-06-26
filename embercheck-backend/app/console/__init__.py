# The assessor Console backend (CONSOLE-B1).
#
# Purely additive data layer for the not-yet-built assessor Console: a gate
# (every route requires current_assessor) and a jurisdiction-scoped worklist of
# submitted cases. It touches NO existing /assess or /cases route and no
# pipeline logic - it only READS cases the consumer flow already produced.
