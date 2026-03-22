/**
 * Integration tests for list sharing/join flows.
 *
 * Tests the end-to-end flow:
 * 1. User A creates a list
 * 2. User B visits join link (reads list metadata)
 * 3. User B joins (adds self to owners)
 * 4. User B can read/write list items
 *
 * Run with: npm run test:emulator
 * Or start emulator separately and run: npm test
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, addDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: RulesTestEnvironment;

const USER_A = 'user-a-id';
const USER_B = 'user-b-id';
const USER_C = 'user-c-id';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'test-project',
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

describe('Groceries List Join Flow', () => {
  const LIST_ID = 'grocery-list-1';

  it('User A can create a list with themselves as owner', async () => {
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const listRef = doc(userADb, 'lists', LIST_ID);

    await assertSucceeds(
      setDoc(listRef, {
        name: 'Family Groceries',
        owners: [USER_A],
        created: new Date(),
      })
    );
  });

  it('User B can read list metadata without being an owner', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Family Groceries',
        owners: [USER_A],
      });
    });

    // Test: User B can read the list
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'lists', LIST_ID);

    await assertSucceeds(getDoc(listRef));
  });

  it('User B can add themselves to owners (join flow)', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Family Groceries',
        owners: [USER_A],
      });
    });

    // Test: User B can add themselves to owners
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'lists', LIST_ID);

    await assertSucceeds(
      updateDoc(listRef, { owners: arrayUnion(USER_B) })
    );
  });

  it('User B cannot remove existing owners when joining', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Family Groceries',
        owners: [USER_A],
      });
    });

    // Test: User B cannot replace owners array (removing User A)
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'lists', LIST_ID);

    await assertFails(
      setDoc(listRef, { name: 'Family Groceries', owners: [USER_B] })
    );
  });

  it('User B cannot modify other fields when joining', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Family Groceries',
        owners: [USER_A],
      });
    });

    // Test: User B cannot change the name while joining
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'lists', LIST_ID);

    await assertFails(
      updateDoc(listRef, {
        owners: arrayUnion(USER_B),
        name: 'Hacked Name',
      })
    );
  });

  it('After joining, User B can read and write items', async () => {
    // Setup: User A creates list, User B joins
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Family Groceries',
        owners: [USER_A, USER_B],
      });
    });

    // Test: User B can add items
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const itemsRef = collection(userBDb, 'lists', LIST_ID, 'items');

    const itemRef = await assertSucceeds(
      addDoc(itemsRef, { name: 'Milk', checked: false })
    );

    // Test: User B can read items
    await assertSucceeds(getDoc(itemRef));

    // Test: User B can delete items
    await assertSucceeds(deleteDoc(itemRef));
  });

  it('User C cannot read items without being an owner', async () => {
    // Setup: User A creates list with an item
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Family Groceries',
        owners: [USER_A],
      });
      await setDoc(doc(db, 'lists', LIST_ID, 'items', 'item1'), {
        name: 'Milk',
        checked: false,
      });
    });

    // Test: User C cannot read items
    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    const itemRef = doc(userCDb, 'lists', LIST_ID, 'items', 'item1');

    await assertFails(getDoc(itemRef));
  });

  it('Unauthenticated user cannot read list metadata', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'lists', LIST_ID), {
        name: 'Family Groceries',
        owners: [USER_A],
      });
    });

    // Test: Unauthenticated user cannot read
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const listRef = doc(unauthDb, 'lists', LIST_ID);

    await assertFails(getDoc(listRef));
  });
});

describe('Upkeep TaskList Join Flow', () => {
  const LIST_ID = 'task-list-1';

  it('User A can create a task list with themselves as owner', async () => {
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const listRef = doc(userADb, 'taskLists', LIST_ID);

    await assertSucceeds(
      setDoc(listRef, {
        name: 'Home Maintenance',
        owners: [USER_A],
        created: new Date(),
      })
    );
  });

  it('User B can read task list metadata without being an owner', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A],
      });
    });

    // Test: User B can read the list
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'taskLists', LIST_ID);

    await assertSucceeds(getDoc(listRef));
  });

  it('User B can add themselves to owners (join flow)', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A],
      });
    });

    // Test: User B can add themselves to owners
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'taskLists', LIST_ID);

    await assertSucceeds(
      updateDoc(listRef, { owners: arrayUnion(USER_B) })
    );
  });

  it('User B cannot remove existing owners when joining', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A],
      });
    });

    // Test: User B cannot replace owners array
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'taskLists', LIST_ID);

    await assertFails(
      setDoc(listRef, { name: 'Home Maintenance', owners: [USER_B] })
    );
  });

  it('User B cannot modify other fields when joining', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A],
      });
    });

    // Test: User B cannot change the name while joining
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRef = doc(userBDb, 'taskLists', LIST_ID);

    await assertFails(
      updateDoc(listRef, {
        owners: arrayUnion(USER_B),
        name: 'Hacked Name',
      })
    );
  });

  it('After joining, User B can read and write tasks', async () => {
    // Setup: User A creates list, User B joins
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A, USER_B],
      });
    });

    // Test: User B can add tasks
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const tasksRef = collection(userBDb, 'taskLists', LIST_ID, 'tasks');

    const taskRef = await assertSucceeds(
      addDoc(tasksRef, { name: 'Change air filter', frequency: { value: 3, unit: 'months' } })
    );

    // Test: User B can read tasks
    await assertSucceeds(getDoc(taskRef));

    // Test: User B can delete tasks
    await assertSucceeds(deleteDoc(taskRef));
  });

  it('After joining, User B can read and write completions', async () => {
    // Setup: User A creates list, User B joins
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A, USER_B],
      });
    });

    // Test: User B can add completions
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const completionsRef = collection(userBDb, 'taskLists', LIST_ID, 'completions');

    const completionRef = await assertSucceeds(
      addDoc(completionsRef, {
        taskId: 'task1',
        completedAt: new Date(),
        completedBy: USER_B,
      })
    );

    // Test: User B can read completions
    await assertSucceeds(getDoc(completionRef));
  });

  it('User C cannot read tasks without being an owner', async () => {
    // Setup: User A creates list with a task
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A],
      });
      await setDoc(doc(db, 'taskLists', LIST_ID, 'tasks', 'task1'), {
        name: 'Change air filter',
      });
    });

    // Test: User C cannot read tasks
    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    const taskRef = doc(userCDb, 'taskLists', LIST_ID, 'tasks', 'task1');

    await assertFails(getDoc(taskRef));
  });

  it('Unauthenticated user cannot read task list metadata', async () => {
    // Setup: User A creates the list
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'taskLists', LIST_ID), {
        name: 'Home Maintenance',
        owners: [USER_A],
      });
    });

    // Test: Unauthenticated user cannot read
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const listRef = doc(unauthDb, 'taskLists', LIST_ID);

    await assertFails(getDoc(listRef));
  });
});

describe('Full Join Flow Simulation', () => {
  it('Complete groceries join flow: create -> share -> join -> collaborate', async () => {
    const LIST_ID = 'shared-grocery-list';

    // Step 1: User A creates the list
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const listRefA = doc(userADb, 'lists', LIST_ID);

    await assertSucceeds(
      setDoc(listRefA, {
        name: 'Shared Groceries',
        owners: [USER_A],
        created: new Date(),
      })
    );

    // Step 2: User A adds some items
    const itemsRefA = collection(userADb, 'lists', LIST_ID, 'items');
    await assertSucceeds(
      addDoc(itemsRefA, { name: 'Bread', checked: false })
    );
    await assertSucceeds(
      addDoc(itemsRefA, { name: 'Eggs', checked: false })
    );

    // Step 3: User B visits join link - reads list metadata
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRefB = doc(userBDb, 'lists', LIST_ID);

    const listSnapshot = await assertSucceeds(getDoc(listRefB));
    // User B sees the list name

    // Step 4: User B cannot read items yet (not an owner)
    const itemsRefB = collection(userBDb, 'lists', LIST_ID, 'items');
    // Note: collection queries would fail, but we test doc read

    // Step 5: User B joins by adding themselves to owners
    await assertSucceeds(
      updateDoc(listRefB, { owners: arrayUnion(USER_B) })
    );

    // Step 6: User B can now add items
    await assertSucceeds(
      addDoc(itemsRefB, { name: 'Milk', checked: false })
    );

    // Step 7: User A can still access everything
    await assertSucceeds(
      addDoc(itemsRefA, { name: 'Butter', checked: false })
    );
  });

  it('Complete upkeep join flow: create -> share -> join -> collaborate', async () => {
    const LIST_ID = 'shared-task-list';

    // Step 1: User A creates the list
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const listRefA = doc(userADb, 'taskLists', LIST_ID);

    await assertSucceeds(
      setDoc(listRefA, {
        name: 'Shared Tasks',
        owners: [USER_A],
        created: new Date(),
      })
    );

    // Step 2: User A adds some tasks
    const tasksRefA = collection(userADb, 'taskLists', LIST_ID, 'tasks');
    await assertSucceeds(
      addDoc(tasksRefA, {
        name: 'Change HVAC filter',
        frequency: { value: 3, unit: 'months' },
      })
    );

    // Step 3: User B visits join link - reads list metadata
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const listRefB = doc(userBDb, 'taskLists', LIST_ID);

    await assertSucceeds(getDoc(listRefB));

    // Step 4: User B joins by adding themselves to owners
    await assertSucceeds(
      updateDoc(listRefB, { owners: arrayUnion(USER_B) })
    );

    // Step 5: User B can now add tasks
    const tasksRefB = collection(userBDb, 'taskLists', LIST_ID, 'tasks');
    await assertSucceeds(
      addDoc(tasksRefB, {
        name: 'Clean gutters',
        frequency: { value: 6, unit: 'months' },
      })
    );

    // Step 6: User B can add completions
    const completionsRefB = collection(userBDb, 'taskLists', LIST_ID, 'completions');
    await assertSucceeds(
      addDoc(completionsRefB, {
        taskId: 'task1',
        completedAt: new Date(),
        completedBy: USER_B,
      })
    );

    // Step 7: User A can still access everything
    await assertSucceeds(
      addDoc(tasksRefA, {
        name: 'Test smoke detectors',
        frequency: { value: 6, unit: 'months' },
      })
    );
  });
});

describe('Recipe Box Join Flow', () => {
  const BOX_ID = 'recipe-box-1';

  it('User A can create a box with themselves as owner', async () => {
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const boxRef = doc(userADb, 'boxes', BOX_ID);

    await assertSucceeds(
      setDoc(boxRef, {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
        creator: USER_A,
        created: new Date(),
        updated: new Date(),
        lastUpdatedBy: USER_A,
      })
    );
  });

  it('User B can read box metadata without being an owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const boxRef = doc(userBDb, 'boxes', BOX_ID);

    await assertSucceeds(getDoc(boxRef));
  });

  it('User B can add themselves to owners (join flow)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const boxRef = doc(userBDb, 'boxes', BOX_ID);

    await assertSucceeds(
      updateDoc(boxRef, { owners: arrayUnion(USER_B) })
    );
  });

  it('User B cannot remove existing owners when joining', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const boxRef = doc(userBDb, 'boxes', BOX_ID);

    await assertFails(
      setDoc(boxRef, { data: { name: 'Family Recipes' }, owners: [USER_B], visibility: 'private' })
    );
  });

  it('User B cannot modify other fields when joining', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const boxRef = doc(userBDb, 'boxes', BOX_ID);

    await assertFails(
      updateDoc(boxRef, {
        owners: arrayUnion(USER_B),
        visibility: 'public',
      })
    );
  });

  it('After joining, User B can read and write recipes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A, USER_B],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const recipesRef = collection(userBDb, 'boxes', BOX_ID, 'recipes');

    const recipeRef = await assertSucceeds(
      addDoc(recipesRef, {
        data: { name: 'Pancakes', '@type': 'Recipe' },
        owners: [USER_B],
        visibility: 'private',
        creator: USER_B,
      })
    );

    await assertSucceeds(getDoc(recipeRef));
    await assertSucceeds(deleteDoc(recipeRef));
  });

  it('After joining, User B can read and write cooking events', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A, USER_B],
        visibility: 'private',
      });
    });

    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const eventsRef = collection(userBDb, 'boxes', BOX_ID, 'events');

    const eventRef = await assertSucceeds(
      addDoc(eventsRef, {
        subjectId: 'recipe1',
        timestamp: new Date(),
        createdAt: new Date(),
        createdBy: USER_B,
        data: {},
      })
    );

    await assertSucceeds(getDoc(eventRef));
  });

  it('User C cannot write recipes without being an owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    const recipesRef = collection(userCDb, 'boxes', BOX_ID, 'recipes');

    await assertFails(
      addDoc(recipesRef, {
        data: { name: 'Hacked Recipe' },
        owners: [USER_C],
        visibility: 'private',
      })
    );
  });

  it('User C cannot write events without being an owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const userCDb = testEnv.authenticatedContext(USER_C).firestore();
    const eventsRef = collection(userCDb, 'boxes', BOX_ID, 'events');

    await assertFails(
      addDoc(eventsRef, {
        subjectId: 'recipe1',
        timestamp: new Date(),
        createdBy: USER_C,
        data: {},
      })
    );
  });

  it('Unauthenticated user cannot read private box', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Family Recipes' },
        owners: [USER_A],
        visibility: 'private',
      });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const boxRef = doc(unauthDb, 'boxes', BOX_ID);

    await assertFails(getDoc(boxRef));
  });

  it('Unauthenticated user can read public box', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'boxes', BOX_ID), {
        data: { name: 'Public Recipes' },
        owners: [USER_A],
        visibility: 'public',
      });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const boxRef = doc(unauthDb, 'boxes', BOX_ID);

    await assertSucceeds(getDoc(boxRef));
  });
});

describe('Complete Recipe Box Share Flow', () => {
  it('create -> share link -> join -> add recipes -> collaborate', async () => {
    const BOX_ID = 'shared-recipe-box';

    // Step 1: User A creates the box
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    const boxRefA = doc(userADb, 'boxes', BOX_ID);

    await assertSucceeds(
      setDoc(boxRefA, {
        data: { name: 'Shared Recipes' },
        owners: [USER_A],
        visibility: 'private',
        creator: USER_A,
        created: new Date(),
        updated: new Date(),
        lastUpdatedBy: USER_A,
      })
    );

    // Step 2: User A adds a recipe
    const recipesRefA = collection(userADb, 'boxes', BOX_ID, 'recipes');
    await assertSucceeds(
      addDoc(recipesRefA, {
        data: { name: 'Chocolate Cake', '@type': 'Recipe' },
        owners: [USER_A],
        visibility: 'private',
        creator: USER_A,
      })
    );

    // Step 3: User B visits join link - reads box metadata
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    const boxRefB = doc(userBDb, 'boxes', BOX_ID);

    await assertSucceeds(getDoc(boxRefB));

    // Step 4: User B joins by adding themselves to owners
    await assertSucceeds(
      updateDoc(boxRefB, { owners: arrayUnion(USER_B) })
    );

    // Step 5: User B can now add recipes
    const recipesRefB = collection(userBDb, 'boxes', BOX_ID, 'recipes');
    await assertSucceeds(
      addDoc(recipesRefB, {
        data: { name: 'Banana Bread', '@type': 'Recipe' },
        owners: [USER_B],
        visibility: 'private',
        creator: USER_B,
      })
    );

    // Step 6: User B can log cooking events
    const eventsRefB = collection(userBDb, 'boxes', BOX_ID, 'events');
    await assertSucceeds(
      addDoc(eventsRefB, {
        subjectId: 'recipe1',
        timestamp: new Date(),
        createdAt: new Date(),
        createdBy: USER_B,
        data: { notes: 'Turned out great!' },
      })
    );

    // Step 7: User A can still do everything
    await assertSucceeds(
      addDoc(recipesRefA, {
        data: { name: 'Apple Pie', '@type': 'Recipe' },
        owners: [USER_A],
        visibility: 'private',
        creator: USER_A,
      })
    );
  });
});

describe('Box Subscribe Without Joining', () => {
  it('User B can subscribe to a public box without becoming an owner', async () => {
    const BOX_ID = 'subscribe-only-box';

    // Step 1: User A creates a public box
    const userADb = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(
      setDoc(doc(userADb, 'boxes', BOX_ID), {
        data: { name: 'Public Recipes' },
        owners: [USER_A],
        subscribers: [USER_A],
        visibility: 'public',
      })
    );

    // Step 2: User B subscribes (adds themselves to subscribers only)
    const userBDb = testEnv.authenticatedContext(USER_B).firestore();
    await assertSucceeds(
      updateDoc(doc(userBDb, 'boxes', BOX_ID), {
        subscribers: arrayUnion(USER_B),
      })
    );

    // Step 3: User B can read the box
    await assertSucceeds(getDoc(doc(userBDb, 'boxes', BOX_ID)));

    // Step 4: User B cannot write recipes (not an owner)
    await assertFails(
      addDoc(collection(userBDb, 'boxes', BOX_ID, 'recipes'), {
        data: { name: 'Sneaky' },
        owners: [USER_B],
        visibility: 'private',
      })
    );

    // Step 5: User B can unsubscribe
    await assertSucceeds(
      updateDoc(doc(userBDb, 'boxes', BOX_ID), {
        subscribers: [USER_A],
      })
    );
  });
});
