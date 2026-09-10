# Independent spring equation reference

`regularized_tick.py` evaluates the planar nine-degree-of-freedom equations with
mpmath, independently of the application and physics engine. The apparatus has
three moving boxes, one fixed body, three pins and an axial spring. The arm radius
is 0.24 m, the second fixed pin is 0.18 m above the first, spring stiffness is
3 N/m and rest length is 0.32 m. Body masses and box inertias are explicit in the
reference and test fixture. There is no gravity or contact.

The reference implements each 1/120 s tick: passive preparation and optional
endpoint damping, four 1/480 s substeps, biased regularized solve, normalized
linearized quaternion drift, refreshed rows, then unbiased solve with retained
spring impulse and elastic sample. Hard constraint CFM is distinct from the
spring motor's large CFM, which represents elastic force and is not a passive
energy loss. Common-point reaction rows include the rotating local-axis term.

`samples.json` owns the case inventory, decimal samples, precision and fixed
comparison policy. The test checks its generator SHA-256. Regenerate optionally
with Python and `mpmath==1.3.0`: run `python3 regenerate.py` in this directory.
Normal test execution requires neither Python nor mpmath. Regeneration takes
roughly three minutes; review changes rather than automatically accepting them.
The generator contains diagnostic equation mutants for independent controls;
ordinary regeneration always uses the unmodified equations.

The 1e-8 comparison limits are engineering regression tolerances frozen before
candidate comparisons, not fitted to their results. The 60-to-80-digit reference
comparison differed by less than 4e-61 at ten seconds. The operation-count scale
64 × machine epsilon × 4800 × 9² is approximately 5.53e-9, rounded to 1e-8.
This is not a rigorous conditioned forward-error bound. The finite sampled gate
does not establish a universal interval enclosure, contact behavior, or exact
continuous mechanics. At the nominal undamped case the independent discrete
reference differs from the ideal scalar trajectory by up to 1.334e-4 radians;
that discretization error is separate from engine/reference agreement.
