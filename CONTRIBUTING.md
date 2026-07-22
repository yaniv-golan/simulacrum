# Contributing to Simulacrum

Thank you for improving Simulacrum. Behavior must emerge from components, connections, environment, and physical laws—not demo identity.

Install Node.js 24.18 LTS, run `npm ci`, then use `npm run dev`. Before opening a pull request, run `npm run security:audit`, `npm run check`, `npm test`, and `npm run build`.

GitHub Actions deliberately separates feedback speed from deep qualification:

- **CI** runs on pull requests and pushes to `main`. It executes the static,
  architecture, contract, coverage, package, and audit gates plus a
  representative browser/simulation smoke set. Tags do not repeat this run.
- **Deep verification** runs weekly or on demand. It executes all verification
  suites, a production build, and the live performance baseline. Its optional
  mutation matrix runs on the weekly schedule and should be requested before a
  release when critical schema, network, controller, challenge, or failure
  decisions changed.
- **Release soak** remains manual because its 30-minute lifecycle exercise is
  useful before releases and high-risk resource changes, not on ordinary pull
  requests.

Run the focused suites related to a change while iterating; the local
definition of done remains stricter than the automatic smoke workflow.

Keep model and simulation modules free of DOM, CSS, cameras, and meshes. Put reusable domain behavior behind `src/core/index.js`. Add deterministic contract tests for physics/model changes and browser assertions for visible behavior. Blueprint input is strict v1: reject missing, unsupported, future, or guessed fields instead of adding compatibility branches. Update architecture, wire schemas, generated validators, and API documentation together when a contract changes.
