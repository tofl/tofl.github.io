---
title: "Amplify Environments vs Amplify Hosting Branches: Understanding the Difference"
---

## Amplify Environments vs Amplify Hosting Branches: Understanding the Difference

If you've worked with AWS Amplify, you've likely encountered a moment of confusion: what's the difference between an Amplify environment and an Amplify Hosting branch? They sound similar, they're both part of Amplify, and they both help you manage different versions of your application. Yet they're solving entirely different problems. Understanding this distinction isn't just about passing an exam—it's fundamental to deploying applications that scale sensibly from development through production.

Let's demystify these concepts and explore how they work together to give you flexible, manageable deployments.

### What Is an Amplify Environment?

An Amplify environment is a complete, isolated backend infrastructure stack. When you run `amplify env add` in your project, you're provisioning a separate set of AWS resources—a distinct DynamoDB table, a different Lambda function, its own Cognito user pool, and so on. Each environment is independent and can have its own database, authentication system, API endpoints, and cloud storage configuration.

Think of an environment as a backend parallel universe. Your development environment might connect to a test database with synthetic data, while your production environment uses real customer data and production-grade configurations. The code that defines these resources is the same; what differs is the *actual infrastructure* that gets created and managed by CloudFormation under the hood.

You can have as many environments as you need. Many teams use three: `dev`, `staging`, and `prod`. Some might add a `qa` environment for quality assurance testing, or a `personal` environment for each developer to experiment freely. Each environment maintains its own state file in AWS, typically stored in an S3 bucket that Amplify manages.

When you deploy Amplify backend changes to an environment, you're updating that specific environment's infrastructure. Changes to your backend code don't affect other environments until you explicitly deploy to them.

### What Is an Amplify Hosting Branch?

Amplify Hosting is a completely separate service that handles frontend deployments. When you connect your Git repository to Amplify Hosting, it automatically creates a deployment pipeline: every push to a specific branch triggers a build and deployment of your frontend code.

A Hosting branch is a deployed instance of your frontend application tied to a Git branch. If you have a `main` branch and a `develop` branch in your repository, Amplify Hosting can automatically build and deploy both. Each branch gets its own URL, its own build logs, and its own deployment history.

The critical insight here: Amplify Hosting branches are *purely frontend infrastructure*. They handle your React, Vue, Angular, or static HTML code. They don't provision backend resources. That's where environments come in.

### The Conceptual Gap: Why Two Systems?

You might wonder why AWS created two separate concepts. The answer lies in team workflows and deployment strategies.

Consider a typical scenario: your development team pushes code constantly to a `develop` branch, but you only want one shared backend for all developers to test against. Amplify Hosting will create a new frontend deployment for each commit to `develop`, but you don't want a new backend provisioned each time. You want one stable `dev` backend that multiple frontend deployments can talk to.

Conversely, you might have a `main` branch that deploys to production frontend, and you want that to connect to a production backend. But you also have a `staging` branch for pre-release testing, and that should connect to a staging backend.

Amplify Hosting handles the *frontend deployment pipeline* based on Git branches. Amplify environments handle the *backend infrastructure* independent of your branching strategy. They're orthogonal concerns, and you need to wire them together yourself.

### Wiring Hosting Branches to Backend Environments

Here's where the practical work happens. By default, when you push code to a Hosting branch, the frontend has no idea which backend environment to talk to. You need to configure this connection explicitly.

The standard approach is through environment variables. When you configure an Amplify Hosting branch, you can specify environment variables that get injected at build time. Your frontend code reads these variables to determine which backend endpoint to call.

For example, you might set an environment variable called `REACT_APP_API_ENDPOINT` on your production Hosting branch to point to your production API Gateway endpoint. On your staging Hosting branch, you'd set the same variable to point to your staging endpoint.

Here's a simple React example:

```javascript
const apiEndpoint = process.env.REACT_APP_API_ENDPOINT || 'http://localhost:3000';

async function fetchUserData() {
  const response = await fetch(`${apiEndpoint}/users`);
  return response.json();
}
```

When you build this code in Amplify Hosting, the environment variable gets substituted. Your staging frontend points to staging APIs, your production frontend points to production APIs.

If you're using the Amplify JavaScript client library, the configuration can be even more sophisticated. You can create an `amplifyconfiguration.json` file that's specific to each environment, with different API endpoints, authentication configurations, and storage buckets per environment.

### Common Deployment Patterns

Teams typically adopt one of a few patterns, each with different tradeoffs.

**One Backend per Hosting Branch**

In this pattern, every Hosting branch gets its own corresponding backend environment. You have `develop` and `dev` environments, `staging` and `staging` environments, `main` and `prod` environments. This provides maximum isolation—each frontend talks to its own backend, and changes to one branch's backend don't affect others.

The downside: you're provisioning more resources and paying for more infrastructure. If you have five feature branches, you're provisioning five backends. For small applications or proof-of-concept work, this overhead matters.

**Shared Staging Backend**

A pragmatic middle ground: multiple development and feature branches all connect to a single shared `staging` backend environment, but `main` connects to `prod`. All developers can test their feature branches against the same staging backend without interfering with each other's backend changes.

This reduces infrastructure costs and simplifies shared testing. The risk is that if one developer makes a breaking backend change to staging, it affects everyone's feature branch tests. Coordination and communication matter here.

**Pull Request Previews with Feature Environments**

Amplify Hosting has a feature called preview deployments for pull requests. When someone opens a pull request, Amplify automatically builds and deploys a temporary frontend for that branch. You can configure it so that each preview deployment gets its own temporary backend environment, spun up just for testing and torn down when the PR closes.

This is powerful for code review workflows: reviewers can test the exact changes in isolation before merging to main.

### Environment Variables and Configuration

The mechanics of wiring branches to environments hinges on build-time configuration. When you configure an Amplify Hosting branch in the AWS console, you can set environment variables:

```
REACT_APP_API_ENDPOINT=https://staging-api.example.com
REACT_APP_REGION=us-east-1
REACT_APP_USER_POOL_ID=us-east-1_abcd1234
```

These get injected into your build process. Your frontend code can read them and adjust its behavior accordingly.

For Amplify projects using the AWS Amplify client library, you typically have an `src/aws-exports.js` file (or `amplifyconfiguration.json` in newer projects) that contains backend configuration. You can parameterize this file based on environment variables:

```javascript
// src/aws-exports.js
const environment = process.env.REACT_APP_ENVIRONMENT || 'development';

const config = {
  development: {
    aws_appsync_graphqlEndpoint: 'https://dev-api.appsync-api.us-east-1.amazonaws.com/graphql',
    aws_appsync_region: 'us-east-1',
    aws_cognito_user_pools_id: 'us-east-1_devpool',
    // ... other settings
  },
  staging: {
    aws_appsync_graphqlEndpoint: 'https://staging-api.appsync-api.us-east-1.amazonaws.com/graphql',
    aws_appsync_region: 'us-east-1',
    aws_cognito_user_pools_id: 'us-east-1_stagingpool',
    // ... other settings
  },
  production: {
    aws_appsync_graphqlEndpoint: 'https://prod-api.appsync-api.us-east-1.amazonaws.com/graphql',
    aws_appsync_region: 'us-east-1',
    aws_cognito_user_pools_id: 'us-east-1_prodpool',
    // ... other settings
  },
};

export default config[environment];
```

Then in your Hosting branch configuration, you set `REACT_APP_ENVIRONMENT=staging`, and your frontend loads the staging configuration.

### Managing Backend Environments Independently

Here's something critical to internalize: your backend environments exist and evolve independently of your Hosting branches. You can update your backend code and deploy to the `dev` environment without touching your frontend. You can push frontend changes to your `develop` Hosting branch without modifying backend infrastructure.

This independence is powerful. It means a frontend developer can iterate on UI while a backend developer works on API improvements, and they don't block each other. But it also means you need to be intentional about versioning and compatibility.

If you deploy a breaking backend change to `staging`—say, removing a field from an API response—and your feature branch frontend still expects that field, you'll get runtime errors. This is why many teams coordinate: before merging backend-breaking changes, you deploy them to a backend environment first, update and test the frontend against that environment, then merge everything together.

### Deploying and Promoting Changes

Let's walk through a realistic scenario. You're working on a new feature across both frontend and backend.

First, you create a feature branch, say `feature/user-dashboard`. You deploy backend changes to your `dev` environment using `amplify push`. You configure a Hosting branch for `feature/user-dashboard` that connects to the `dev` backend environment via environment variables.

Every time you push to your feature branch, Amplify Hosting builds and deploys the frontend automatically. You can test the new frontend against the `dev` backend.

When the feature is ready, you open a pull request. Amplify creates a temporary preview deployment. Everything looks good, so you merge to `main`.

The merge triggers a build of your `main` Hosting branch. Separately, when you're ready, you promote your backend changes from `dev` to `prod` using `amplify env add prod` or by deploying to an existing `prod` environment with `amplify push --envs prod`. The `main` Hosting branch is configured to connect to the `prod` backend environment.

Frontend and backend promotions can happen at different times. You might deploy frontend changes hours before backend changes if you're careful about backward compatibility, or vice versa.

### Best Practices and Gotchas

**Name Your Environments Clearly**

Use naming conventions that make sense. `dev`, `staging`, `prod` are clear and widely understood. Avoid single-letter or cryptic names that confuse team members.

**Document Your Wiring**

Keep a simple document or README that explains which Hosting branch connects to which backend environment. New team members will appreciate it, and you'll save yourself from debugging mysteries three months later.

**Use Amplify Hooks for Environment-Specific Logic**

Amplify's build hooks let you run scripts before and after the build. You can use these to validate that the frontend is configured for the correct backend environment before deploying:

```bash
# amplify.yml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - echo "Validating environment configuration..."
        - test -n "$REACT_APP_API_ENDPOINT" || (echo "Missing REACT_APP_API_ENDPOINT" && exit 1)
```

**Be Careful with Shared Backends**

If multiple Hosting branches connect to a shared backend environment, database migrations and schema changes can affect multiple frontend versions simultaneously. This is usually fine if those frontends are compatible with the new schema, but it's a coordination point worth highlighting.

**Understand Cold Starts and Latency**

Connecting to a different region's backend from a Hosting branch adds latency. If your `main` branch is deployed globally via CloudFront but connects to a backend in `us-east-1`, users in other regions might experience slowness. This is an architectural consideration distinct from the environment/branch distinction, but it's worth keeping in mind.

### Real-World Example: A Full Deployment Flow

Imagine a small SaaS team using Amplify. They have a backend API, a React frontend, and they want a sensible deployment process.

Their setup: three backend environments (`dev`, `staging`, `prod`) and three Hosting branches (`develop`, `staging`, `main`). The mapping is straightforward.

A developer starts a new feature in a branch called `feature/analytics`. They push to this branch, and since there's no Hosting branch configured for it yet, their feature code doesn't deploy. They work locally, running `amplify mock` to test with the `dev` backend.

When they want to test in a live environment, they push to the `develop` Hosting branch (or create a new one for this feature). The frontend builds and deploys, connecting to the `dev` backend via environment variables set in Hosting configuration.

After internal review and testing, the changes move to the `staging` Hosting branch. At this point, both frontend and backend changes are deployed to staging. The team runs integration tests, QA tests, and load tests. The staging environment mirrors production as closely as possible.

Finally, the code merges to `main`. The frontend deploys to production via the `main` Hosting branch. The backend was already promoted to `prod` during staging, or it gets promoted immediately after. Both are now live.

If something goes wrong in production, the team can roll back the frontend by redeploying the previous commit to `main` (Amplify Hosting tracks all deployments). Backend rollbacks are more complex and depend on your database strategy, but the infrastructure is separate and can be managed independently.

### Conclusion

The distinction between Amplify environments and Amplify Hosting branches is a matter of scope: environments are backend infrastructure, branches are frontend deployments. They're independent systems that you intentionally connect through configuration and environment variables. Understanding this separation of concerns is essential for building scalable, manageable Amplify applications.

The key takeaway: don't assume a one-to-one mapping between branches and environments. They're flexible, and different teams will wire them together differently based on their deployment needs, team size, and risk tolerance. The simplest mental model is to think of environments as "backend infrastructure stacks" and branches as "frontend Git-based deployments," recognize they're independent, and then deliberately configure how they connect via environment variables.

With this clarity, you'll design deployment pipelines that are both powerful and understandable, making it easier for your team to move code from development to production confidently.
