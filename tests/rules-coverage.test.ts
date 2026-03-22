/**
 * Comprehensive Firestore rules coverage tests.
 *
 * Covers areas not tested by join-flow.test.ts:
 * - Recipe visibility matrix (7-condition read rule)
 * - Recipe-level ownership (write without box ownership)
 * - Cooking log subcollection access
 * - User document isolation
 * - Box delete restrictions
 * - Life tracker read permissions
 * - Grocery/upkeep subcollection coverage (history, trips, events)
 *
 * Run with: npm run test:emulator
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: RulesTestEnvironment;

const USER_A = 'user-a-id';
const USER_B = 'user-b-id';
const USER_C = 'user-c-id';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'test-project-coverage',
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8180,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ==========================================
// Recipe Visibility Matrix
// ==========================================

describe('Recipe Visibility Matrix', () => {
  const BOX_ID = 'vis-box';
  const RECIPE_ID = 'vis-recipe';

  async function setupBoxAndRecipe(boxVisibility: string, recipeVisibility: string, boxOwners = [USER_A], recipeOwners = [USER_A]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Test Box' },
        owners: boxOwners,
        visibility: boxVisibility,
      });
      await setDoc(doc(db, 'boxes', BOX_ID, 'recipes', RECIPE_ID), {
        data: { name: 'Test Recipe' },
        owners: recipeOwners,
        visibility: recipeVisibility,
      });
    });
  }

  // --- Unauthenticated access ---

  it('unauth can read public recipe in public box', async () => {
    await setupBoxAndRecipe('public', 'public');
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(unauthDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  it('unauth can read public recipe in private box', async () => {
    await setupBoxAndRecipe('private', 'public');
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(unauthDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  it('unauth can read private recipe in public box', async () => {
    await setupBoxAndRecipe('public', 'private');
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    // Box is public, so recipe is readable via box visibility
    await assertSucceeds(getDoc(doc(unauthDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  it('unauth cannot read private recipe in private box', async () => {
    await setupBoxAndRecipe('private', 'private');
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  // --- Authenticated non-owner access ---

  it('auth non-owner can read public recipe in private box', async () => {
    await setupBoxAndRecipe('private', 'public');
    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    await assertSucceeds(getDoc(doc(userCDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  it('auth non-owner can read private recipe in public box', async () => {
    await setupBoxAndRecipe('public', 'private');
    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    // Box visibility != 'private', so authenticated users can read
    await assertSucceeds(getDoc(doc(userCDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  it('auth non-owner cannot read private recipe in private box', async () => {
    await setupBoxAndRecipe('private', 'private');
    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    await assertFails(getDoc(doc(userCDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  // --- Owner access ---

  it('box owner can read private recipe in private box', async () => {
    await setupBoxAndRecipe('private', 'private');
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(getDoc(doc(userADb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });

  it('recipe owner (non-box-owner) can read private recipe in private box', async () => {
    await setupBoxAndRecipe('private', 'private', [USER_A], [USER_B]);
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertSucceeds(getDoc(doc(userBDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID)));
  });
});

// ==========================================
// Recipe-Level Ownership (write)
// ==========================================

describe('Recipe-Level Ownership', () => {
  const BOX_ID = 'ownership-box';
  const RECIPE_ID = 'ownership-recipe';

  it('recipe owner can update recipe even without box ownership', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'private',
      });
      await setDoc(doc(db, 'boxes', BOX_ID, 'recipes', RECIPE_ID), {
        data: { name: 'Shared Recipe' },
        owners: [USER_A, USER_B],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const recipeRef = doc(userBDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID);

    await assertSucceeds(
      updateDoc(recipeRef, { 'data.name': 'Updated by recipe owner' })
    );
  });

  it('non-owner cannot update recipe', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'private',
      });
      await setDoc(doc(db, 'boxes', BOX_ID, 'recipes', RECIPE_ID), {
        data: { name: 'Recipe' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    const recipeRef = doc(userCDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID);

    await assertFails(
      updateDoc(recipeRef, { 'data.name': 'Hacked' })
    );
  });

  it('box owner can create recipes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(
      addDoc(collection(userADb, 'boxes', BOX_ID, 'recipes'), {
        data: { name: 'New Recipe' },
        owners: [USER_A],
        visibility: 'private',
      })
    );
  });

  it('recipe-only owner cannot create new recipes in that box', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'private',
      });
      await setDoc(doc(db, 'boxes', BOX_ID, 'recipes', RECIPE_ID), {
        data: { name: 'Existing' },
        owners: [USER_A, USER_B],
        visibility: 'private',
      });
    });

    // User B is a recipe owner but not a box owner
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      addDoc(collection(userBDb, 'boxes', BOX_ID, 'recipes'), {
        data: { name: 'Sneaky Recipe' },
        owners: [USER_B],
        visibility: 'private',
      })
    );
  });

  it('recipe owner can delete their recipe even without box ownership', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'private',
      });
      await setDoc(doc(db, 'boxes', BOX_ID, 'recipes', RECIPE_ID), {
        data: { name: 'Recipe' },
        owners: [USER_A, USER_B],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertSucceeds(
      deleteDoc(doc(userBDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID))
    );
  });
});

// ==========================================
// Cooking Log Subcollection
// ==========================================

describe('Cooking Log Subcollection', () => {
  const BOX_ID = 'cooklog-box';
  const RECIPE_ID = 'cooklog-recipe';

  async function setup(boxOwners = [USER_A], recipeOwners = [USER_A]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: boxOwners,
        visibility: 'private',
      });
      await setDoc(doc(db, 'boxes', BOX_ID, 'recipes', RECIPE_ID), {
        data: { name: 'Recipe' },
        owners: recipeOwners,
        visibility: 'private',
      });
    });
  }

  it('box owner can read/write cooking log', async () => {
    await setup();
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const logRef = await assertSucceeds(
      addDoc(collection(userADb, 'boxes', BOX_ID, 'recipes', RECIPE_ID, 'cookingLog'), {
        madeAt: new Date(),
        madeBy: USER_A,
      })
    );
    await assertSucceeds(getDoc(logRef));
  });

  it('recipe-only owner cannot access cooking log (requires box ownership)', async () => {
    await setup([USER_A], [USER_A, USER_B]);
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();

    await assertFails(
      addDoc(collection(userBDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID, 'cookingLog'), {
        madeAt: new Date(),
        madeBy: USER_B,
      })
    );
  });

  it('non-owner cannot access cooking log', async () => {
    await setup();
    const userCDb = testEnv.authenticatedContext(USER_C).firestore();

    await assertFails(
      addDoc(collection(userCDb, 'boxes', BOX_ID, 'recipes', RECIPE_ID, 'cookingLog'), {
        madeAt: new Date(),
        madeBy: USER_C,
      })
    );
  });
});

// ==========================================
// User Document Isolation
// ==========================================

describe('User Document Isolation', () => {
  it('user can read their own document', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', USER_A), {
        name: 'User A',
        visibility: 'private',
        boxes: [],
      });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(getDoc(doc(userADb, 'users', USER_A)));
  });

  it('user can write their own document', async () => {
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(
      setDoc(doc(userADb, 'users', USER_A), {
        name: 'User A',
        visibility: 'private',
        boxes: [],
      })
    );
  });

  it('user cannot read another user document', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', USER_A), {
        name: 'User A',
        visibility: 'private',
        boxes: [],
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(userBDb, 'users', USER_A)));
  });

  it('user cannot write another user document', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', USER_A), {
        name: 'User A',
        visibility: 'private',
        boxes: [],
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      updateDoc(doc(userBDb, 'users', USER_A), { name: 'Hacked' })
    );
  });

  it('user can read/write their own boxes subcollection', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', USER_A), { name: 'User A' });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const boxRef = doc(userADb, 'users', USER_A, 'boxes', 'box1');
    await assertSucceeds(setDoc(boxRef, { name: 'My Box' }));
    await assertSucceeds(getDoc(boxRef));
  });

  it('user cannot access another user boxes subcollection', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', USER_A), { name: 'User A' });
      await setDoc(doc(db, 'users', USER_A, 'boxes', 'box1'), { name: 'Private Box' });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(userBDb, 'users', USER_A, 'boxes', 'box1')));
  });

  it('unauthenticated user cannot read any user document', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', USER_A), { name: 'User A' });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthDb, 'users', USER_A)));
  });
});

// ==========================================
// Box Delete Restrictions
// ==========================================

describe('Box Delete Restrictions', () => {
  const BOX_ID = 'delete-box';

  it('owner can delete their box', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(deleteDoc(doc(userADb, 'boxes', BOX_ID)));
  });

  it('non-owner cannot delete a box', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(deleteDoc(doc(userBDb, 'boxes', BOX_ID)));
  });

  it('unauthenticated user cannot delete a box', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Box' },
        owners: [USER_A],
        visibility: 'public',
      });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(unauthDb, 'boxes', BOX_ID)));
  });
});

// ==========================================
// Life Tracker Rules
// ==========================================

describe('Life Tracker Rules', () => {
  const LOG_ID = 'life-log-1';

  it('any authenticated user can read any life log', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'My Tracker',
      });
    });

    // User C is not an owner but can still read
    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    await assertSucceeds(getDoc(doc(userCDb, 'lifeLogs', LOG_ID)));
  });

  it('unauthenticated user cannot read life logs', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'My Tracker',
      });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthDb, 'lifeLogs', LOG_ID)));
  });

  it('user can create a life log with themselves as owner', async () => {
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(
      setDoc(doc(userADb, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'My Tracker',
      })
    );
  });

  it('user cannot create a life log without themselves as owner', async () => {
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      setDoc(doc(userBDb, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'Fake Tracker',
      })
    );
  });

  it('owner can update their life log', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'My Tracker',
      });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(
      updateDoc(doc(userADb, 'lifeLogs', LOG_ID), { name: 'Updated Tracker' })
    );
  });

  it('non-owner cannot update a life log', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'My Tracker',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      updateDoc(doc(userBDb, 'lifeLogs', LOG_ID), { name: 'Hacked' })
    );
  });

  it('owner can delete their life log', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'My Tracker',
      });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(deleteDoc(doc(userADb, 'lifeLogs', LOG_ID)));
  });

  it('non-owner cannot delete a life log', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), {
        owners: [USER_A],
        name: 'My Tracker',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(deleteDoc(doc(userBDb, 'lifeLogs', LOG_ID)));
  });

  // --- Entries subcollection ---

  it('owner can read/write entries', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), { owners: [USER_A] });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const entryRef = await assertSucceeds(
      addDoc(collection(userADb, 'lifeLogs', LOG_ID, 'entries'), {
        value: 5,
        timestamp: new Date(),
      })
    );
    await assertSucceeds(getDoc(entryRef));
  });

  it('non-owner cannot read/write entries', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), { owners: [USER_A] });
      await setDoc(doc(db, 'lifeLogs', LOG_ID, 'entries', 'entry1'), {
        value: 5,
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(userBDb, 'lifeLogs', LOG_ID, 'entries', 'entry1')));
    await assertFails(
      addDoc(collection(userBDb, 'lifeLogs', LOG_ID, 'entries'), { value: 99 })
    );
  });

  // --- Events subcollection ---

  it('owner can read/write life events', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), { owners: [USER_A] });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const eventRef = await assertSucceeds(
      addDoc(collection(userADb, 'lifeLogs', LOG_ID, 'events'), {
        timestamp: new Date(),
        createdBy: USER_A,
        data: { value: 7 },
      })
    );
    await assertSucceeds(getDoc(eventRef));
  });

  it('non-owner cannot read/write life events', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lifeLogs', LOG_ID), { owners: [USER_A] });
      await setDoc(doc(db, 'lifeLogs', LOG_ID, 'events', 'ev1'), {
        timestamp: new Date(),
        data: {},
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(userBDb, 'lifeLogs', LOG_ID, 'events', 'ev1')));
    await assertFails(
      addDoc(collection(userBDb, 'lifeLogs', LOG_ID, 'events'), {
        timestamp: new Date(),
        data: {},
      })
    );
  });
});

// ==========================================
// Grocery Subcollections (history, trips)
// ==========================================

describe('Grocery Subcollections', () => {
  const LIST_ID = 'grocery-sub-list';

  async function setupList(owners = [USER_A]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Groceries',
        owners,
      });
    });
  }

  // --- History ---

  it('owner can read/write history', async () => {
    await setupList();
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const histRef = doc(userADb, 'lists', LIST_ID, 'history', 'milk');

    await assertSucceeds(setDoc(histRef, { lastPurchased: new Date(), count: 5 }));
    await assertSucceeds(getDoc(histRef));
  });

  it('non-owner cannot read/write history', async () => {
    await setupList();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID, 'history', 'milk'), {
        lastPurchased: new Date(),
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(userBDb, 'lists', LIST_ID, 'history', 'milk')));
    await assertFails(
      setDoc(doc(userBDb, 'lists', LIST_ID, 'history', 'eggs'), { count: 1 })
    );
  });

  it('joined user can read/write history', async () => {
    await setupList([USER_A, USER_B]);
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const histRef = doc(userBDb, 'lists', LIST_ID, 'history', 'bread');

    await assertSucceeds(setDoc(histRef, { lastPurchased: new Date() }));
    await assertSucceeds(getDoc(histRef));
  });

  // --- Trips ---

  it('owner can read/write trips', async () => {
    await setupList();
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const tripRef = await assertSucceeds(
      addDoc(collection(userADb, 'lists', LIST_ID, 'trips'), {
        date: new Date(),
        items: ['milk', 'bread'],
      })
    );
    await assertSucceeds(getDoc(tripRef));
  });

  it('non-owner cannot read/write trips', async () => {
    await setupList();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID, 'trips', 'trip1'), {
        date: new Date(),
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(userBDb, 'lists', LIST_ID, 'trips', 'trip1')));
    await assertFails(
      addDoc(collection(userBDb, 'lists', LIST_ID, 'trips'), { date: new Date() })
    );
  });

  it('joined user can read/write trips', async () => {
    await setupList([USER_A, USER_B]);
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const tripRef = await assertSucceeds(
      addDoc(collection(userBDb, 'lists', LIST_ID, 'trips'), {
        date: new Date(),
        items: ['eggs'],
      })
    );
    await assertSucceeds(getDoc(tripRef));
  });
});

// ==========================================
// Upkeep Events Subcollection
// ==========================================

describe('Upkeep Events Subcollection', () => {
  const LIST_ID = 'upkeep-events-list';

  async function setupTaskList(owners = [USER_A]) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Tasks',
        owners,
      });
    });
  }

  it('owner can read/write events', async () => {
    await setupTaskList();
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const eventRef = await assertSucceeds(
      addDoc(collection(userADb, 'taskLists', LIST_ID, 'events'), {
        subjectId: 'task1',
        timestamp: new Date(),
        createdBy: USER_A,
        data: {},
      })
    );
    await assertSucceeds(getDoc(eventRef));
  });

  it('non-owner cannot read/write events', async () => {
    await setupTaskList();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID, 'events', 'ev1'), {
        subjectId: 'task1',
        timestamp: new Date(),
        data: {},
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(userBDb, 'taskLists', LIST_ID, 'events', 'ev1')));
    await assertFails(
      addDoc(collection(userBDb, 'taskLists', LIST_ID, 'events'), {
        subjectId: 'task1',
        timestamp: new Date(),
        data: {},
      })
    );
  });

  it('joined user can read/write events', async () => {
    await setupTaskList([USER_A, USER_B]);
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const eventRef = await assertSucceeds(
      addDoc(collection(userBDb, 'taskLists', LIST_ID, 'events'), {
        subjectId: 'task1',
        timestamp: new Date(),
        createdBy: USER_B,
        data: { notes: 'Done!' },
      })
    );
    await assertSucceeds(getDoc(eventRef));
  });
});

// ==========================================
// Grocery List Create/Delete Restrictions
// ==========================================

describe('Grocery List Create/Delete Restrictions', () => {
  const LIST_ID = 'restrict-list';

  it('user cannot create a list without themselves as owner', async () => {
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      setDoc(doc(userBDb, 'lists', LIST_ID), {
        name: 'Fake List',
        owners: [USER_A],
      })
    );
  });

  it('owner can delete their list', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Groceries',
        owners: [USER_A],
      });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(deleteDoc(doc(userADb, 'lists', LIST_ID)));
  });

  it('non-owner cannot delete a list', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Groceries',
        owners: [USER_A],
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(deleteDoc(doc(userBDb, 'lists', LIST_ID)));
  });
});

// ==========================================
// Upkeep TaskList Create/Delete Restrictions
// ==========================================

describe('Upkeep TaskList Create/Delete Restrictions', () => {
  const LIST_ID = 'restrict-tasklist';

  it('user cannot create a task list without themselves as owner', async () => {
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      setDoc(doc(userBDb, 'taskLists', LIST_ID), {
        name: 'Fake Tasks',
        owners: [USER_A],
      })
    );
  });

  it('owner can delete their task list', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Tasks',
        owners: [USER_A],
      });
    });

    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(deleteDoc(doc(userADb, 'taskLists', LIST_ID)));
  });

  it('non-owner cannot delete a task list', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Tasks',
        owners: [USER_A],
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(deleteDoc(doc(userBDb, 'taskLists', LIST_ID)));
  });
});
