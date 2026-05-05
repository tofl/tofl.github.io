---
title: "Fine-Grained Access Control in OpenSearch: Roles, Users, and Backend Roles"
---

## Fine-Grained Access Control in OpenSearch: Roles, Users, and Backend Roles

When you're managing an OpenSearch domain in production, you quickly realize that a simple "you can access this cluster or you can't" approach won't cut it. You need developers who can search product data but not see customer PII. You need analytics teams reading aggregated metrics while data engineers can modify indices. You need multi-tenant deployments where customer A's data remains invisible to customer B, even though they're querying the same cluster. This is where OpenSearch's Fine-Grained Access Control (FGAC) becomes essential—and understanding it deeply will serve you well both in your AWS work and in real-world security architecture.

Fine-Grained Access Control is a powerful security plugin that ships with OpenSearch and Amazon OpenSearch Service. It lets you move beyond cluster-level permissions and define precisely who can do what, at every level from index access down to individual fields within a document. But FGAC isn't just about adding a list of rules; it's an entire permission model that interacts with how you authenticate users, define roles, and map identities to those roles.

### Understanding the OpenSearch Security Plugin Architecture

Before you can effectively use Fine-Grained Access Control, you need to understand the architecture that makes it work. OpenSearch's security comes from a plugin that handles authentication, authorization, and audit logging. This plugin sits at the request gateway level, meaning every query, every index operation, every administrative action passes through it.

The security plugin consists of several moving parts working together. There's an authentication layer that answers "who are you?" This layer can verify identities in multiple ways: it can check internal user credentials stored in OpenSearch itself, it can delegate to external systems like LDAP or Active Directory, it can accept SAML assertions from identity providers, or it can use AWS IAM roles if you're running on Amazon OpenSearch Service. Once a user is authenticated, the authorization layer asks "what are you allowed to do?" This is where Fine-Grained Access Control comes in—it's the authorization engine that evaluates permissions.

The security plugin also handles role management, user management, and the critical mapping between users and roles. A user might be "john.smith@acme.com" when authenticated through SAML, but you need to map that identity to an internal role like "analytics_read_only" to give them actual permissions.

One architectural detail that surprises many developers: when you enable FGAC on an OpenSearch domain, you must do so at cluster creation time. You cannot enable the security plugin after the cluster exists. This is a hard requirement that affects your infrastructure planning. If you attempt to create a domain without FGAC and later realize you need it, you'll need to create a new cluster and migrate your data over. It's worth planning for this upfront.

### Internal Users Versus Backend Roles and External Authentication

OpenSearch distinguishes between two fundamental concepts: users and backend roles. Understanding this distinction is crucial because it determines how your authentication system integrates with your authorization model.

Internal users are credentials stored directly within OpenSearch itself. When you create an internal user named "app_service" with a password, that user's identity exists only in OpenSearch. There's no connection to your corporate directory, AWS IAM, or any external system. Internal users are useful for service accounts, for testing, or for applications that can't authenticate through more sophisticated mechanisms. They're straightforward but require you to manage credentials within OpenSearch, which introduces operational overhead. If you need to rotate credentials, you do it by updating OpenSearch's internal user database. If you need to audit login attempts, you're relying on OpenSearch's audit logging rather than centralized identity monitoring.

Backend roles take a different approach. Instead of storing credentials in OpenSearch, you authenticate users through an external system—like AWS IAM, Amazon Cognito, SAML, LDAP, or Kerberos—and that external system asserts one or more backend roles that the user possesses. The user's credentials are verified by the external system, not by OpenSearch. OpenSearch then receives this information and uses it to determine what the user can do.

This distinction matters enormously in multi-tenant or enterprise deployments. Imagine you're building a SaaS platform where customers authenticate through your own Cognito instance. When customer A's employee logs in, Cognito verifies their password and then asserts backend roles like "customer_a_user" and "customer_a_analyst". These roles travel with the user's request to OpenSearch, and OpenSearch's authorization engine checks what "customer_a_analyst" can access. When customer B's employee logs in, they get different backend roles, and their permissions are completely separate. You never store customer B's credentials in OpenSearch; you never need to manage their passwords. You leverage your existing identity provider as the source of truth.

On Amazon OpenSearch Service specifically, you can integrate with AWS Identity and Access Management (IAM) as an authentication source. This means a developer who can assume an IAM role automatically gets authenticated to OpenSearch without needing a separate password. When they make a request with their AWS credentials, OpenSearch validates the signature using AWS SigV4 and associates them with backend roles based on their IAM role's name. This creates a seamless experience where authentication and authorization flow from your existing AWS identity infrastructure.

The power of backend roles becomes visible when you need to revoke access quickly. If a developer leaves your company and you remove them from your Cognito user pool or disable their IAM role, they immediately lose access to OpenSearch—without any changes to OpenSearch itself. If instead you were using internal users, you'd need to remember to delete that user from OpenSearch separately, and there's a window of vulnerability if you forget.

### Defining Roles with Index, Document, and Field-Level Permissions

OpenSearch roles are where the actual permissions live. A role is a collection of permissions that you can grant to users (or rather, grant to backend roles that users possess). The permissions in a role operate at multiple levels, giving you fine-grained control.

At the broadest level, there are cluster permissions. These control access to cluster-wide operations like viewing node status, managing indices, changing cluster settings, or accessing the cluster state. A developer might have the permission to view cluster health without being able to modify cluster configuration.

Index-level permissions are more specific. When you define a role, you specify which indices it can access and what operations it can perform on those indices. You might say "this role can read from the 'products' index but cannot write to it" or "this role can do anything with the 'logs_2024' index but cannot access any other index". Index names can use wildcards, so "logs_*" matches all indices starting with "logs_". This is powerful for time-series data where you might create new indices daily and want new developers automatically inheriting access to future indices without explicit permission changes.

Document-level permissions let you restrict access to specific documents within an index, based on the content of those documents. Imagine a healthcare application where you have a single index containing patient records. A nurse should only see documents for patients in their hospital ward. A document-level permission would look something like: "users in the 'ward_3_nurses' role can only read documents where the 'ward' field equals 'Ward 3'". This is evaluated at query time—if a nurse searches the patient index, OpenSearch automatically filters results to only documents matching their permission criteria. They can't bypass this by crafting a clever query; the filtering happens within OpenSearch itself.

Field-level permissions are the finest grain. Even if a user can access a document, you can restrict which fields they see. In that same healthcare example, a billing clerk might need to see patient names and procedures (to match against insurance claims) but should never see psychiatric notes or other sensitive fields. When a billing clerk queries the patient index, sensitive fields are simply redacted from the response. If they try to request specific field names in their query, OpenSearch will return an error rather than the field.

Implementing these permissions requires understanding the role definition syntax. In OpenSearch, roles are defined in JSON and stored in the security plugin's configuration index. A typical role might look like this: it specifies cluster-level permissions in a "cluster_permissions" array, index-level permissions in an "index_permissions" array where you define the index patterns and allowed actions, and then within each index permission, you can specify document-level queries and field restrictions.

When you build multi-tenant systems, these granular permissions become essential. Consider a SaaS analytics platform where multiple organizations subscribe. Each organization should only see their own data. You might create a pattern where every document contains an "org_id" field, and every role for a customer employee has a document-level restriction matching their organization. This way, you maintain a single index for all organizations but guarantee data isolation without requiring separate indices or clusters.

### Role Mapping: Connecting Backend Roles to Permissions

Once you've defined roles in OpenSearch with their associated permissions, you face a critical question: how do those permissions get applied to actual users? This is where role mapping comes in.

Role mapping is the process of taking a user's backend roles (those roles asserted by your authentication system) and mapping them to OpenSearch roles (those roles with actual permissions). It's a translation layer that bridges identity and authorization.

Here's a concrete example: your company authenticates developers through SAML. When a developer logs in, the SAML identity provider asserts that they belong to the "engineers" group in Active Directory. This "engineers" assertion travels with their request to OpenSearch as a backend role. Now, in OpenSearch's security configuration, you define a role mapping that says: "the backend role 'engineers' maps to the OpenSearch role 'development_team_role'". The development_team_role has permissions to search the "source_code_metrics" index and modify the "team_dashboards" index. Through this mapping, that engineer automatically gets those permissions.

Role mappings are also stored in OpenSearch's configuration index and can be viewed and modified through the OpenSearch Dashboards security interface or via the REST API. You can have multiple backend roles mapping to a single OpenSearch role, or a backend role mapping to multiple OpenSearch roles. This flexibility lets you build complex permission hierarchies. For instance, you might have a backend role for "senior_engineers" that maps to both "development_team_role" and "deployment_team_role", granting them permissions from both.

In Amazon OpenSearch Service with IAM authentication, role mapping happens based on IAM role names. If a developer assumes the IAM role "arn:aws:iam::123456789:role/DataAnalyst", OpenSearch can map that to the backend role "DataAnalyst" automatically, assuming your IAM role naming aligns with your OpenSearch role naming. Alternatively, you can create explicit mappings in OpenSearch that rewrite IAM roles to different names.

A nuance that catches many developers: role mappings are not transitive. If backend role A maps to OpenSearch role X, and OpenSearch role X inherits permissions from OpenSearch role Y (through role nesting), that's fine. But if you want backend role A to have the same permissions as backend role B, you must map both to the same OpenSearch roles or have them map to roles that inherit from the same parent role. You can't map A to B and expect B's permissions to flow through.

### The Master User Concept and Initial Setup

Every OpenSearch cluster with FGAC enabled must have a master user. The master user is a special account with unrestricted permissions—essentially, a superuser who can perform any action on the cluster. This includes creating users, managing roles, granting permissions, and modifying the security configuration itself. Without a master user, there's no way to bootstrap the security system or recover from misconfiguration.

When you create an Amazon OpenSearch Service domain with FGAC enabled, you must provide master user credentials. You choose between creating an internal master user (with a username and password stored in OpenSearch) or using an IAM master user (where an IAM role serves as the master user). The internal master user approach is simpler for initial setup but requires storing and protecting a password. The IAM master user approach integrates with your AWS credential infrastructure but requires the IAM role to exist before creating the domain.

The master user is critical for recovery scenarios. If you accidentally lock yourself out by removing all permissions from your authenticated account, you can always use the master user to restore access. This makes the master user's credentials something you must protect carefully and store securely—consider using AWS Secrets Manager to store the master user password rather than leaving it in a configuration file.

During initial setup, you use the master user to create other users, define roles, and set up role mappings. This is often done through OpenSearch Dashboards' security interface, which provides a graphical workflow for managing users and permissions.

### Enabling FGAC: A One-Time Decision

Here's a critical detail that affects your infrastructure planning: Fine-Grained Access Control must be enabled when you create an OpenSearch domain. You cannot enable it on an existing domain that was created without security. This is a hard architectural constraint.

Why? The security plugin needs to be initialized at cluster boot time and must create and manage internal configuration indices from the start. Enabling it post-creation would require complex migrations and could leave the cluster in an inconsistent state. AWS and OpenSearch require you to make this decision upfront.

This means that when you're designing an OpenSearch deployment, you should enable FGAC from the beginning, even if you plan a simple permission model initially. It's far easier to start with basic permissions and expand them later than to realize you need FGAC six months in and have to rebuild your cluster.

If you inherit an OpenSearch cluster without security enabled and need to add FGAC, your migration path is: create a new domain with security enabled, configure your roles and users, migrate your indices using index snapshots or reindexing, and then shift your application to point to the new domain. This is not a trivial operation for large deployments.

### Practical Permission Scenarios: Index Isolation in Multi-Tenant Systems

Let's move from theory to a concrete example that illustrates how all these pieces work together. Imagine you're building a multi-tenant SaaS platform where customer data is indexed in OpenSearch. Each customer has their own employees who need to access the analytics dashboards, but they should never see another customer's data.

Your architecture might look like this: you use a single OpenSearch domain with multiple indices. Each customer has their data in indices named like "customer_001_data", "customer_002_data", and so on. Employees authenticate through your Cognito user pool. When a customer A employee logs in through Cognito, the user pool emits a backend role called "customer_001_user".

Now, in OpenSearch, you define a role called "customer_001_analyst". This role has index-level permissions granting access to "customer_001_data" index and to "customer_001_dashboards" index (where their dashboards are stored). The role does not grant access to any other customer's indices. You create a role mapping: the backend role "customer_001_user" maps to the OpenSearch role "customer_001_analyst".

When a customer A employee makes a request, Cognito authenticates them and asserts the backend role "customer_001_user". OpenSearch's security plugin receives this backend role, looks up the role mapping, finds that it maps to "customer_001_analyst", applies those permissions, and evaluates their request against those permissions. If they try to query "customer_002_data", OpenSearch denies the request because the "customer_001_analyst" role has no permissions on that index.

You can extend this pattern for different user types within a customer. Customer A might have both analysts and administrators. The "customer_001_admin" role could have permissions to modify indices, manage users within their customer namespace, and access administrative dashboards. Cognito would emit a different backend role for admins—say "customer_001_admin"—and you'd map that to the "customer_001_admin" OpenSearch role.

If you need even finer granularity—perhaps analysts should only see non-sensitive fields—you can add field-level permissions. A role might specify that the "customer_001_analyst" role can read from "customer_001_data" but cannot see the "internal_notes" or "cost_fields" fields.

This model scales cleanly. When a new customer signs up, you create new indices for their data, define new roles, add new backend roles from Cognito (or use a naming pattern like "customer_NNN_user" where NNN is the customer ID), and create role mappings. Your application code doesn't change; the security model handles the isolation automatically.

### Using OpenSearch Dashboards Security Interface

While much of FGAC configuration can be done via REST APIs, the OpenSearch Dashboards security interface provides a user-friendly way to manage users, roles, and mappings. As a practitioner, you'll likely spend time in this interface.

When you access the Security section of OpenSearch Dashboards (available in the left sidebar when security is enabled), you'll see several tabs: Internal Users, Roles, Role Mappings, Tenants, and sometimes Audit Logs.

The Internal Users tab lets you create and manage internal user accounts. You can set passwords, which are hashed and stored in OpenSearch's internal security index. For each user, you can assign OpenSearch roles directly, even without creating an explicit role mapping. This is a convenience feature; behind the scenes, it's still creating role associations.

The Roles tab shows all defined roles and lets you create new ones. When creating a role, you specify cluster permissions (like "cluster_all" for full access or specific permissions like "cluster:monitor/health"), then define index permissions. For each index pattern, you specify which actions are allowed: "read", "write", "delete_index", "manage", etc. You can also define document-level and field-level restrictions here.

The Role Mappings tab connects backend roles (from SAML, LDAP, IAM, or Cognito) to OpenSearch roles. This is where you'd map "engineers" from SAML to "development_team_role" in OpenSearch, or map IAM role names to OpenSearch roles.

The interface also includes helpful elements like role validation—if you try to create a role with invalid permissions, the interface will warn you. It shows which users and backend roles are mapped to each role, helping you understand permission inheritance at a glance.

For complex setups or infrastructure-as-code approaches, you might manage FGAC configuration through APIs or Terraform, but the Dashboards interface is invaluable for understanding your security model and debugging permission issues.

### Permission Evaluation and Caching

Understanding how OpenSearch evaluates permissions helps you troubleshoot access issues and design efficient permission models. When a user makes a request, OpenSearch's security plugin evaluates their permissions against the request, but this doesn't happen naively on every single request.

OpenSearch caches authentication and authorization information. Once a user is authenticated (their credentials verified), subsequent requests with the same credentials can reuse cached information, reducing the overhead of repeated authentication checks, especially for external authentication systems like LDAP or SAML.

However, authorization information is also cached, which means if you change a role's permissions or a role mapping, there can be a delay before all cluster nodes pick up the change. The cache has a Time-To-Live (TTL); by default, it's relatively short (a few minutes), but even this window can be important in practice. In critical security scenarios, you might manually trigger a cache refresh through the REST API rather than waiting for the TTL to expire.

Similarly, when you're debugging permission issues, remember that a user who was previously denied access might gain access after a role change, but if they have a cached authentication token or if the cluster hasn't yet propagated the permission change to all nodes, they might still be denied temporarily. This is usually not a problem in practice, but it's worth understanding.

### Common Pitfalls and Best Practices

Several patterns emerge from working with FGAC in production deployments, and avoiding these pitfalls will save you significant troubleshooting time.

The first pitfall is being too permissive initially and forgetting to tighten permissions. It's tempting to grant "all" permissions while you're building and testing, planning to restrict them later. In practice, "later" never comes, and you end up in production with overly broad permissions. Instead, define roles with specific, minimal permissions from the start. You can always expand permissions as new requirements emerge.

A second pitfall is neglecting the distinction between cluster permissions and index permissions. Some developers grant cluster:admin permissions thinking this means "admin for all indices", but it actually grants cluster-level administration like modifying cluster settings. To be an admin for a specific index, you need index-level permissions on that index, not cluster permissions.

A third pitfall emerges in multi-tenant systems: assuming that document-level permissions are a substitute for proper isolation. While document-level permissions are powerful, they're evaluated at query time and can have performance implications for very large datasets. They're also more prone to misconfiguration than index-level isolation. For maximum security and performance, use index-level separation (different indices per tenant) and supplement with document-level permissions where needed.

A fourth pitfall is not testing role permissions before deploying to production. Permissions can be counterintuitive. A user might have read permission on an index but not the permission to retrieve field mappings, which would prevent dashboards from loading properly. Test the complete user experience—not just index queries, but also dashboard loading, aggregations, and any other operations your users need.

Best practices that emerge: use a consistent naming convention for your roles and backend roles, so you and your team can understand them at a glance. "customer_001_analyst" is clear; "cust1_a" is not. Document your role hierarchy and role mappings so new team members can understand your security model. Use role inheritance where possible (roles that extend other roles) to avoid duplicating permissions. And always test permission changes in a non-production environment first.

### Conclusion

Fine-Grained Access Control in OpenSearch transforms it from a single-user-or-everyone platform into a sophisticated, enterprise-grade system where you can define precisely who can do what, at every level from cluster operations down to individual fields within documents. The interplay between authentication (users and backend roles), authorization (OpenSearch roles with specific permissions), and role mappings creates a flexible framework for everything from simple internal deployments to complex multi-tenant SaaS platforms.

The key concepts to internalize are: internal users versus backend roles and external authentication, the levels at which permissions can be applied (cluster, index, document, field), the master user's critical role in bootstrap and recovery, the requirement to enable FGAC at cluster creation time, and the practical mechanics of role mapping. With these foundations solid, you're equipped to design secure OpenSearch deployments that scale and adapt to changing requirements.

The learning path forward involves hands-on practice: create a test domain with FGAC, define a few roles with different permission levels, set up role mappings from external authentication, and verify that permissions work as expected. Once you've done this, the concepts crystallize, and you'll find yourself designing permission models almost intuitively.
