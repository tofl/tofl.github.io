---
title: "Enforcing SSL/TLS Connections to RDS for MySQL and PostgreSQL"
---

## Enforcing SSL/TLS Connections to RDS for MySQL and PostgreSQL

Securing database connections in transit is one of those responsibilities that feels straightforward until something breaks in production. Data traveling between your application and Amazon RDS is a critical security boundary, and SSL/TLS encryption protects it from interception and man-in-the-middle attacks. Yet many developers discover too late that enforcing encryption requires more than just flipping a switch—it demands understanding certificate management, parameter group configuration, client-side validation, and the mechanics of certificate rotation events.

This article walks through everything you need to know to properly enforce SSL/TLS on RDS MySQL and PostgreSQL instances. We'll explore why encryption in transit matters, how to set it up correctly, how to troubleshoot the inevitable connection issues, and how to handle certificate rotation without downtime. By the end, you'll have a solid mental model for securing your database layer and be equipped to handle real-world scenarios.

### Why Encryption in Transit Matters for Databases

Before diving into implementation, let's acknowledge why this matters. Your database contains your application's most valuable data. If connections travel unencrypted across a network—whether that's the internet or even within your VPC—they're vulnerable to packet sniffing. An attacker positioned on the network path could read SQL queries, extract credentials, or modify data in flight.

AWS RDS doesn't enable SSL/TLS enforcement by default. This is intentional; AWS wants to avoid breaking existing applications that weren't designed with encrypted connections in mind. The burden falls on you to enable enforcement and ensure your clients support it. This is why understanding the mechanics matters—you're not just enabling a feature, you're changing how your application authenticates and communicates with the database.

### The RDS Certificate Architecture

AWS uses Certificate Authority (CA) certificates to sign the certificates presented by your RDS instances. When you connect with SSL/TLS, your client receives the RDS instance's certificate and needs to verify it against a trusted CA. AWS provides these CA certificates in a bundle that you download and make available to your application.

The CA certificates follow a versioning scheme. Historically, AWS used certificates like `rds-ca-2019`, but these eventually reach end-of-life. AWS has transitioned to `rds-ca-rsa2048-g1`, which uses RSA 2048-bit encryption and is valid through 2099. Understanding this versioning matters because AWS performs certificate rotation events where instances are updated to present certificates signed by the newer CA. These events are scheduled and communicated in advance, but if your client isn't configured to trust the new CA, connections will fail after rotation.

### Downloading and Managing the RDS Certificate Bundle

Your first step is obtaining the CA certificate bundle. AWS hosts this as a public file that you can download and version-control with your application code.

Download the current RDS CA certificate bundle using this command:

```bash
wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

Alternatively, for specific regions or CA versions:

```bash
# Regional bundle (example: us-east-1)
wget https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem

# Specific CA version (example: rds-ca-rsa2048-g1)
wget https://truststore.pki.rds.amazonaws.com/global/rds-ca-rsa2048-g1-bundle.pem
```

It's a best practice to download and commit the bundle to your application's repository rather than relying on fetching it at runtime. This ensures you have a known, tested version of the certificates and can validate them independently. Inspect the bundle to verify it contains multiple CA certificates:

```bash
grep "BEGIN CERTIFICATE" global-bundle.pem | wc -l
```

You should see multiple entries, covering different CA versions to ensure backward compatibility during rotation periods.

### Configuring PostgreSQL for SSL/TLS Enforcement

PostgreSQL on RDS uses the `rds.force_ssl` parameter to enforce SSL/TLS connections. This is a simple boolean parameter, but its effects are significant: once enabled, any connection attempt that doesn't use SSL will be rejected.

To enable `rds.force_ssl`, you'll modify the parameter group associated with your RDS instance. If you're using the default parameter group, create a new custom parameter group first because the default group can't be modified.

Navigate to the RDS console and select your instance's parameter group. Search for `rds.force_ssl` and set it to `1`. Then reboot the database instance to apply the change. The reboot is necessary because PostgreSQL needs to reload its configuration.

```
Parameter: rds.force_ssl
Value: 1
Apply Immediately: false (reboot required)
```

Once enabled, verify it's active by connecting to the instance and checking the parameter:

```sql
SHOW rds.force_ssl;
```

If it returns `on`, enforcement is active. Any attempt to connect without SSL will fail with an authentication error.

On the client side, configure your connection string to use SSL and provide the CA bundle. In psql, this looks like:

```bash
psql -h your-rds-endpoint.rds.amazonaws.com \
  -U postgres \
  -d postgres \
  --set=sslmode=require \
  --set=sslrootcert=./global-bundle.pem
```

The `sslmode=require` parameter tells psql to require SSL and verify the server certificate against the provided CA bundle. Other common values are `verify-full` (which also verifies the hostname matches the certificate) and `disable` (which disables SSL entirely—never use this in production).

In application code, most PostgreSQL drivers allow you to specify SSL parameters in the connection string or as connection options. For example, in Python with psycopg2:

```python
import psycopg2

conn = psycopg2.connect(
    host="your-rds-endpoint.rds.amazonaws.com",
    user="postgres",
    password="your-password",
    database="postgres",
    sslmode="require",
    sslrootcert="./global-bundle.pem"
)
```

### Configuring MySQL for SSL/TLS Enforcement

MySQL on RDS takes a slightly different approach. Instead of a single parameter like PostgreSQL, MySQL uses `require_secure_transport`, which enforces SSL/TLS for all connections when set to `ON`.

Similar to PostgreSQL, you'll modify the parameter group. Search for `require_secure_transport` and set it to `1` (or `ON` if the console allows it).

```
Parameter: require_secure_transport
Value: 1
Apply Immediately: false (reboot required)
```

Reboot the instance to activate the parameter. Verify it's set correctly by connecting and running:

```sql
SHOW VARIABLES LIKE 'require_secure_transport';
```

The response should show `ON` or `1`.

For MySQL clients, the connection process is similar but uses different syntax. With the mysql command-line client:

```bash
mysql -h your-rds-endpoint.rds.amazonaws.com \
  -u admin \
  -p \
  --ssl-ca=./global-bundle.pem \
  --ssl-mode=REQUIRED
```

In Python with mysql-connector-python:

```python
import mysql.connector

conn = mysql.connector.connect(
    host="your-rds-endpoint.rds.amazonaws.com",
    user="admin",
    password="your-password",
    database="mysql",
    ssl_ca="./global-bundle.pem",
    ssl_disabled=False
)
```

Or with PyMySQL, which requires a slightly different approach:

```python
import pymysql
import ssl

conn = pymysql.connect(
    host="your-rds-endpoint.rds.amazonaws.com",
    user="admin",
    password="your-password",
    database="mysql",
    ssl={"ca": "./global-bundle.pem"}
)
```

The exact method depends on your driver. Consult your driver's documentation for SSL configuration options.

### Understanding Certificate Rotation Events

AWS periodically rotates RDS CA certificates. A rotation event means AWS is deprecating an old CA (like `rds-ca-2019`) and transitioning to a new one (like `rds-ca-rsa2048-g1`). During the transition period, AWS supports both CA versions so existing clients continue working. However, once the old CA reaches end-of-life, it's no longer supported, and clients relying on it will fail.

AWS announces rotation events well in advance and provides a schedule for when instances will be updated. You don't need to manually update your instance's certificate—AWS handles that. What you do need is to ensure your client's CA bundle is current.

The safest approach is to regularly update your CA bundle and test it before it's required. Download the latest global bundle and run your test suite against it. Since the global bundle contains multiple CA versions, your clients can continue working even during the transition period.

```bash
# In your deployment pipeline or manually
wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
# Commit and deploy
```

If you discover after a rotation event that your application can't connect, the likely culprit is an outdated CA bundle that doesn't include the new CA certificate. Updating the bundle and restarting your application will fix it.

### Troubleshooting Common SSL/TLS Connection Errors

When SSL/TLS enforcement is enabled, connection issues become more complex because failures can occur at the SSL handshake level, before your application logic even runs.

**Certificate Verification Failed**: This error typically means your client has `require_secure_transport` or `sslmode=require` enabled, but the CA bundle doesn't contain the CA that signed the RDS certificate. Update your CA bundle to the latest version.

**SSL Connection Refused**: This could mean the RDS instance doesn't have SSL enabled (check your RDS console and security group settings) or the enforcement parameter isn't set. Verify `rds.force_ssl` or `require_secure_transport` is enabled and the instance was rebooted.

**Hostname Mismatch**: If using `sslmode=verify-full` in PostgreSQL or equivalent settings in MySQL, the certificate's Common Name or Subject Alternative Name must match your RDS endpoint hostname. AWS certificates should include the RDS endpoint, so this is rare, but it can occur if you're using a custom endpoint or proxy.

**Connection Timeout**: This usually indicates a network connectivity issue rather than an SSL problem, but verify that your security group allows outbound connections on port 3306 (MySQL) or 5432 (PostgreSQL). Your RDS instance's security group should allow inbound traffic on these ports from your application's security group.

To diagnose SSL issues, increase logging verbosity. With psql:

```bash
psql -h your-endpoint.rds.amazonaws.com -U postgres \
  --set=sslmode=require \
  --set=sslrootcert=./global-bundle.pem \
  -c "SELECT version();" -v VERBOSITY=verbose
```

For MySQL, enable verbose output (though the mysql client has limited debugging):

```bash
mysql -h your-endpoint.rds.amazonaws.com -u admin -p \
  --ssl-ca=./global-bundle.pem \
  --ssl-mode=REQUIRED \
  -v -e "SELECT VERSION();"
```

If you're debugging from your application code, most drivers have debug logging. For example, in Python with psycopg2, enable logging to see SSL-related messages:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

### Best Practices for SSL/TLS in Production

Enforcing SSL/TLS is a security best practice, but it requires thoughtful rollout to avoid breaking your application. Here are practical recommendations:

Start by enabling SSL in your test and development environments first. Deploy the configuration with enforcement disabled, configure your clients to use SSL, and test thoroughly. Only after confirming that all your clients can connect with SSL should you enable enforcement.

Use the global CA bundle rather than region-specific bundles. The global bundle contains certificates for all regions and handles transitions gracefully.

Automate CA bundle updates in your deployment pipeline. Rather than manually updating bundles, incorporate bundle downloads into your build process so updates happen consistently across your infrastructure.

Set up monitoring for SSL/TLS connection failures. If enforcement is enabled but your client configuration is wrong, you'll see a spike in connection errors. Alerting on this helps you catch configuration issues early.

Document your SSL/TLS configuration as part of your runbook. Include the steps to update the CA bundle, how to configure each client library, and what to do if a certificate rotation event breaks connections. Future-you will appreciate this documentation when you're debugging at 2 AM.

### Conclusion

Enforcing SSL/TLS on RDS is a critical step in securing your data in transit, but it's not a single toggle. It requires understanding the certificate architecture, configuring both the RDS parameters and your clients, and planning for certificate rotation events. The good news is that once you've done it correctly, it becomes a non-issue—your clients authenticate, connections remain secure, and certificate rotations happen transparently.

The key takeaways are straightforward: download and manage the RDS CA bundle, enable enforcement via `rds.force_ssl` for PostgreSQL or `require_secure_transport` for MySQL, configure your clients to present that bundle and require SSL, and keep the bundle updated. Do this, and you'll have a secure database layer that can scale with confidence. The slight operational overhead of managing certificates is trivial compared to the security benefit of encryption in transit.
