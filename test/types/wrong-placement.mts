import { createPlacementLifecycle } from '../../src/presentation/placement-lifecycle.mjs';
const placement = createPlacementLifecycle<{ partId: string }>();
placement.assess({ partId: 7 });
