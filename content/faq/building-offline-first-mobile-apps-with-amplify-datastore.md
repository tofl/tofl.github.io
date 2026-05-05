---
title: "Building Offline-First Mobile Apps with Amplify DataStore"
---

## Building Offline-First Mobile Apps with Amplify DataStore

The moment your mobile user loses signal, their experience shouldn't fall apart. Yet building applications that gracefully handle disconnection, maintain data consistency, and sync seamlessly when the connection returns remains one of the trickiest challenges in modern app development. This is where Amplify DataStore changes the game.

DataStore is AWS Amplify's sophisticated local-first data persistence solution that lets developers build applications as though they're always connected, while handling the messy reality of spotty networks behind the scenes. Rather than forcing you to write complex synchronization logic and conflict resolution code, DataStore abstracts away these concerns so you can focus on your application logic.

In this guide, we'll explore how DataStore works under the hood, why offline-first architecture matters, and how to build resilient applications that delight users even when their network connection doesn't cooperate.

### Why Offline-First Architecture Matters

Before diving into the technical implementation, let's establish why offline-first matters. Traditional cloud-connected applications are fundamentally online-first: they treat the network as a guaranteed resource and fail gracefully when connectivity drops. Users experience loading screens, error dialogs, or worse—lost data.

Offline-first flips this assumption. Your application treats the local device as the source of truth and views the network as an optional enhancement. When the user performs an action, that action succeeds locally with immediate visual feedback. The network synchronization happens asynchronously, often without the user even noticing.

This architectural shift delivers tangible benefits. Applications feel snappier because there's no waiting for network round trips. Users can continue working in the subway, on a flight, or in a dead zone. Data loss becomes nearly impossible because changes persist locally before ever touching the network. And paradoxically, even with excellent connectivity, applications often feel more responsive because the UI isn't blocked waiting for server confirmation.

### Understanding DataStore's Local-First Architecture

DataStore operates differently depending on your platform. In web browsers, it leverages IndexedDB—a powerful browser-native database that provides structured storage with excellent query capabilities. On React Native and Flutter applications, DataStore uses SQLite, a proven relational database that's been battle-tested across billions of devices.

The brilliance of this approach is that your application code remains largely platform-agnostic. You write the same DataStore queries whether you're targeting web, iOS, or Android, and DataStore handles the platform-specific persistence details.

When you initialize DataStore, it creates a local schema that mirrors your backend data model. If you've defined your data types using AWS Amplify's schema definition language, DataStore automatically translates that into the appropriate local database structure. For example, a simple Todo application might define:

```graphql
type Todo @model {
  id: ID!
  title: String!
  completed: Boolean
  createdAt: AWSDateTime!
}
```

DataStore transforms this into local tables with the same structure, indexed for efficient querying. All subsequent operations happen against this local store—reads are instant, writes are immediate, and there's no network latency to slow down your UI.

### The Mutation Queue: Handling Offline Changes

The magic truly begins when your user makes changes while offline. Rather than throwing an error, DataStore silently queues the mutation locally. From the user's perspective, their change succeeded immediately. The application updates, the UI reflects the new state, and life goes on.

Behind the scenes, DataStore tracks these pending changes in a separate metadata store. This metadata includes the operation (create, update, or delete), the affected record, and a timestamp. When your application goes offline, subsequent mutations continue accumulating in this queue.

Let's consider a concrete example. A field service technician uses your app to manage service tickets. While driving between jobs in an area with poor signal, they mark several tickets as complete and add notes. Each action succeeds locally with immediate feedback. DataStore invisibly queues these mutations. The technician finishes their work without interruption or frustration.

This queuing mechanism handles deletion gracefully too. If a user deletes a record while offline, DataStore marks it for deletion and queues the operation. Even if the user closes and reopens the application, DataStore remembers that deletion needs to happen. The local record appears deleted to the application, but the pending deletion remains queued until synchronization occurs.

### Synchronization: When Connectivity Returns

The moment connectivity returns, DataStore awakens. It automatically begins processing the mutation queue, sending each pending change to your backend API in the correct order. This is crucial—mutations must be applied in the sequence they occurred, or you risk inconsistent data.

DataStore handles this with an elegant append-only log approach. Each mutation receives a version number and timestamp, establishing a clear order. When synchronizing, DataStore sends mutations in this order, and your backend applies them sequentially.

The synchronization process uses AWS AppSync, Amplify's GraphQL API service, to send mutations. AppSync executes your mutation resolvers on the backend, which typically persist data to DynamoDB or another data source. As each mutation succeeds, DataStore removes it from the local queue.

What's particularly elegant is that DataStore never loses track of pending mutations. If synchronization is interrupted mid-way through—perhaps the user's phone lost signal again—DataStore intelligently resumes from where it left off when reconnected. It won't resend mutations that already succeeded, and it won't skip any that failed.

### Conflict Resolution: When Two Changes Collide

Real-world applications must grapple with a thorny problem: what happens when the same record is modified both offline and on the server before synchronization completes? This is the classic conflict resolution challenge.

Imagine two users collaborating on a document. User A goes offline and edits a paragraph. Meanwhile, User B—still online—edits the same paragraph. When User A reconnects, whose change wins? If you simply overwrite, data loss occurs. If you reject the offline changes, users lose faith in offline functionality. DataStore's approach is more sophisticated.

DataStore implements version-based conflict detection. Each record maintains a version number that increments with every change. When you create a record, it starts at version 1. When you update it, the version becomes 2. This continues indefinitely.

When offline changes are synchronized, DataStore compares the version of your offline change with the current server version. If they match—meaning no one else modified the record in the interim—the update succeeds cleanly. If the versions diverge, DataStore has detected a conflict.

By default, DataStore uses an "optimistic" strategy for conflict resolution, applying your local changes. However, you can customize this behavior. Amplify provides hooks to implement your own conflict resolution logic. Perhaps you want the last write to win. Maybe you need to merge changes in application-specific ways. Or perhaps certain types of conflicts should alert the user.

Here's how you can customize conflict resolution:

```typescript
DataStore.configure({
  DataStore: {
    conflictHandler: async (data) => {
      const { remoteModel, localModel, modelConstructor, operation } = data;
      
      // Implement your conflict resolution logic
      if (operation === 'UPDATE') {
        // Example: merge the two versions in an app-specific way
        return localModel; // or remoteModel, or a merged version
      }
      
      return localModel; // default to local version
    },
  },
});
```

This flexibility means you can implement conflict resolution strategies appropriate to your domain. A calendar application might merge overlapping events. A collaborative text editor might apply both changes. A shopping cart might take the version with the most recent timestamp.

### Observing Real-Time Changes with Subscriptions

Beyond queuing and synchronization, DataStore provides a powerful observation mechanism through subscriptions. You can subscribe to changes on specific models and react instantly when data changes—whether those changes originate from your app, other users, or your backend.

In a React application, you might observe a Todo list like this:

```typescript
import { DataStore } from 'aws-amplify';
import { Todo } from './models';
import { useEffect, useState } from 'react';

export function TodoList() {
  const [todos, setTodos] = useState([]);
  
  useEffect(() => {
    const subscription = DataStore.observeQuery(Todo).subscribe(
      (snapshot) => {
        setTodos(snapshot.items);
      }
    );
    
    return () => subscription.unsubscribe();
  }, []);
  
  return (
    // Render todos
  );
}
```

The `observeQuery` method returns an observable stream of query results. Whenever the data changes—whether from a local mutation or a remote update—the subscription fires with the updated snapshot. This pattern eliminates the need for manual refetching and keeps your UI perfectly synchronized with your data.

You can also observe individual models:

```typescript
const subscription = DataStore.observe(Todo, todoId).subscribe(
  (snapshot) => {
    console.log('Todo changed:', snapshot.element);
  }
);
```

This triggers whenever that specific todo is modified. It's a clean, reactive pattern that pairs beautifully with modern frameworks like React or Flutter.

### Building a Practical Example: Notes Application

Let's bring all these concepts together by building a simple notes application. We'll use React Native, though the pattern translates seamlessly to web or Flutter.

First, define your schema:

```graphql
type Note @model @auth(rules: [{ allow: owner }]) {
  id: ID!
  title: String!
  content: String!
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}
```

Initialize Amplify and DataStore in your app:

```typescript
import { Amplify } from 'aws-amplify';
import { DataStore } from 'aws-amplify/datastore';
import awsconfig from './aws-exports';

Amplify.configure(awsconfig);
```

Create a component that allows users to add notes:

```typescript
import { DataStore } from 'aws-amplify/datastore';
import { Note } from './models';
import { useState } from 'react';

export function CreateNote() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  
  const handleCreate = async () => {
    const newNote = await DataStore.save(
      new Note({
        title,
        content,
      })
    );
    
    setTitle('');
    setContent('');
    console.log('Note created:', newNote);
  };
  
  return (
    // Form UI
  );
}
```

When the user taps "Create," DataStore immediately saves to the local database and returns the new note. If they're offline, the operation still succeeds locally. The mutation gets queued and syncs automatically once connectivity returns.

Display notes with real-time synchronization:

```typescript
import { DataStore } from 'aws-amplify/datastore';
import { Note } from './models';
import { useEffect, useState } from 'react';

export function NotesList() {
  const [notes, setNotes] = useState([]);
  
  useEffect(() => {
    const subscription = DataStore.observeQuery(Note).subscribe((snapshot) => {
      setNotes(snapshot.items);
    });
    
    return () => subscription.unsubscribe();
  }, []);
  
  return (
    // Render notes list
  );
}
```

The component automatically updates whenever notes change, whether from local mutations or synced remote updates. Users see their notes appear instantly, and collaborative changes from other users appear in real time.

For updates, you'd retrieve a note, modify it, and save:

```typescript
const updatedNote = await DataStore.save(
  Note.copyOf(existingNote, (updated) => {
    updated.content = newContent;
  })
);
```

Again, this succeeds immediately. The application reflects the change instantly. If offline, the mutation queues. When reconnected, DataStore syncs the change, handling any conflicts according to your configured strategy.

### Handling Edge Cases and Best Practices

While DataStore handles much complexity automatically, a few considerations improve your implementation.

**Initial Sync Strategy**: When a user first launches your app, DataStore performs an initial sync to populate the local database with existing remote data. This can take time on slow networks or if you have substantial data. Consider showing a loading screen during initial sync and perhaps implementing pagination to reduce the amount of data downloaded initially.

**Storage Limitations**: Local databases have finite capacity. On web, IndexedDB typically allows 50MB or more depending on the browser. On mobile, SQLite provides substantially more space. If your application deals with massive datasets, implement query pagination and clear old data intelligently rather than attempting to store everything locally.

**Background Sync**: In web applications, you might want DataStore to continue syncing even after users close their browser tab. Service Workers can help here by persisting pending mutations and resuming sync when the browser reopens.

**Model Relationships**: DataStore handles relationships between models, but they require careful consideration. When you define a "belongs to" or "has many" relationship, DataStore manages the foreign keys locally. Ensure your queries include related data appropriately using the `includes` parameter.

**Authentication**: DataStore respects Amplify's authentication rules. Unauthenticated users can use DataStore for local data, but synchronization requires authentication. Design your app to handle both states gracefully—perhaps using DataStore for local-only data before login, then syncing authenticated data once the user logs in.

### When to Use DataStore (and When Not To)

DataStore shines for applications with significant offline usage, collaborative features, or unreliable network conditions. It's ideal for field service apps, note-taking applications, social platforms, and any scenario where immediate response times matter more than perfect real-time consistency.

However, DataStore isn't universally optimal. For applications requiring strict consistency guarantees or transactional semantics across multiple records, consider AppSync directly with careful backend logic. For highly sensitive financial transactions, you might want explicit synchronization checkpoints rather than automatic background sync. For applications with minimal offline needs, the overhead of maintaining local databases might not be justified.

DataStore is also most valuable when you're using AWS as your backend. While DataStore can theoretically sync with non-AWS APIs, the integration is less seamless.

### Conclusion

Amplify DataStore elegantly solves offline-first architecture by handling the complexity of local persistence, mutation queuing, intelligent synchronization, and conflict resolution. Rather than writing thousands of lines of synchronization logic, you leverage a battle-tested framework that handles edge cases and failure modes automatically.

The result is applications that feel snappy and responsive regardless of network conditions. Users get immediate feedback. Data loss becomes virtually impossible. And developers spend their time building features rather than wrestling with synchronization logic.

Start by defining your data model in Amplify's schema language, initialize DataStore in your application, and begin querying and mutating data as though you're always connected. The offline complexity happens behind the scenes, invisible to your application code. As you grow more sophisticated, customize conflict resolution and sync strategies to match your domain's unique requirements.

The offline-first approach, powered by DataStore, represents a fundamental shift in how we build mobile and web applications—one that prioritizes user experience and data resilience. Once you've experienced it, it's hard to imagine building connected applications any other way.
