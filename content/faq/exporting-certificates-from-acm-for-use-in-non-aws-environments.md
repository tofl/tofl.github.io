---
title: "Exporting Certificates from ACM for Use in Non-AWS Environments"
---

## Exporting Certificates from ACM for Use in Non-AWS Environments

If you've ever found yourself managing infrastructure across both AWS and non-AWS environments, you've probably encountered this frustrating moment: you've set up a beautiful certificate in AWS Certificate Manager, but now you need to use it on an on-premises server or a third-party appliance. That's when reality hits—AWS Certificate Manager's public certificates aren't exportable. But there's a workaround, and understanding when and how to use it is essential for any developer working in hybrid or multi-cloud environments.

This article explores the certificate export landscape in AWS, explains why certain limitations exist, and provides you with practical techniques for extending your certificate infrastructure beyond AWS's managed boundaries.

### Understanding ACM's Export Limitations

Let's start with the core constraint: AWS Certificate Manager issues two types of certificates, and they have fundamentally different export capabilities.

**Public certificates** issued by ACM are tied directly to AWS services. They're designed to work seamlessly with Elastic Load Balancers, CloudFront distributions, API Gateway, and other AWS resources. These certificates cannot be exported. This isn't an arbitrary restriction—it's by design. AWS manages the private keys for public certificates on your behalf, keeping them secure within AWS infrastructure. Exporting them would mean exposing those keys outside AWS's security boundaries, which runs counter to the principle of key isolation.

**Private certificates**, on the other hand, are issued through AWS Certificate Manager Private Certificate Authority. These are designed for internal use within your organization—for applications, services, and infrastructure that you control. The crucial difference is that you own the private CA, and AWS allows you to export certificates issued by your private CA for use anywhere you need them.

This distinction shapes the entire export strategy you'll need to adopt if you're managing hybrid infrastructure.

### Why You Might Need to Export Certificates

Before diving into the mechanics, let's talk about the real-world scenarios where certificate export becomes necessary.

The most common situation is hybrid infrastructure. Perhaps you're migrating from on-premises to AWS gradually, and you need consistent certificate handling across both environments during the transition period. Or you might be in a permanent hybrid state—some workloads in AWS, others running on-premises or in private data centers. In these cases, using the same certificate across both domains reduces operational overhead and ensures consistent identity across your infrastructure.

Another scenario involves third-party appliances. Load balancers, API gateways, or security appliances from vendors like F5, Citrix, or Fortinet often need their own certificate management. They can't directly access AWS Certificate Manager, so you need to export the certificate and install it on the appliance.

Integration with legacy systems presents another real challenge. Older applications, especially those built before cloud-native practices became standard, might have certificate requirements that differ from modern AWS approaches. They might expect certificates in specific formats, stored in particular locations, or managed through their own keystores.

Compliance and regulatory requirements sometimes demand that you maintain escrow copies of certificates. In certain industries, particularly finance and healthcare, regulations require that certificate private keys be held in escrow by a third party. Exporting allows you to fulfill these requirements.

Finally, some organizations maintain strict separation of concerns. The infrastructure team might manage non-AWS systems independently and need direct access to certificates rather than going through AWS APIs.

### Setting Up a Private CA for Export

To export certificates, you need AWS Certificate Manager Private Certificate Authority. This is different from the free public certificates ACM provides. Let me walk you through the setup.

First, you create a root CA. This can be a self-signed root CA managed by AWS, or you can import an existing CA certificate. For most organizations starting fresh, the self-signed approach is simpler. When you create the root CA, AWS generates and securely stores the private key. You can never export the root key itself—it stays in AWS's HSM-backed storage—but you can export certificates issued by this CA.

Once your root CA exists, you might optionally create subordinate CAs. This is useful if you want different organizational units or departments to have their own signing authority. The subordinate CA is itself a certificate issued by the root, but it has the authority to issue end-entity certificates. Many organizations find this structure reflects their certificate hierarchy and approval workflows.

After your CA is set up, you configure certificate issuance. This typically happens through a certificate request from your application or service. The private CA can be queried for certificates on demand, or you can pre-issue certificates for known hosts and services.

### The Export Process: GetCertificate API

The actual export happens through the ACM Private CA `GetCertificate` API. This is the gateway to retrieving your certificate data in a usable format.

Here's how it works in practice. Suppose you've issued a certificate for your on-premises web server `internal.example.com`. You now need to export it for installation. The process involves three main outputs: the certificate itself (the public certificate), the certificate chain (intermediate and root certificates), and optionally the private key.

When you call `GetCertificate`, you provide the certificate ARN and serial number. AWS returns the certificate body in PEM format (base64-encoded text), which is the universal format supported by virtually all platforms.

Let me show you a practical example. If you're using the AWS CLI:

```bash
aws acm-pca get-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012 \
  --certificate-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012/certificate/12345678 \
  --output text
```

This returns the certificate in PEM format. You can redirect this to a file:

```bash
aws acm-pca get-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012 \
  --certificate-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012/certificate/12345678 \
  --query Certificate \
  --output text > certificate.pem
```

The API also returns the certificate chain separately, which you'll need for proper validation. The certificate chain includes intermediate CA certificates and typically the root CA certificate.

### Understanding Certificate Chain Structure

A certificate chain is crucial to understand because it's often the source of validation errors when people first export certificates.

A typical chain looks like this: **End-entity certificate → Intermediate CA certificate → Root CA certificate**. The end-entity certificate is the actual certificate for your server. The intermediate CA certificate proves that the issuing CA is legitimate. The root CA certificate is self-signed and represents the trust anchor.

When a client connects to your server and receives the end-entity certificate, it doesn't automatically trust it. The client needs to verify the entire chain up to a trusted root. For public CAs like DigiCert or Let's Encrypt, the root certificates are already in most operating systems and browsers. But for private CAs, you need to distribute the root certificate to clients so they can validate the chain.

When exporting from AWS Certificate Manager Private CA, you typically get all three pieces. The `GetCertificate` API returns the end-entity certificate in one field and the certificate chain in another. Some platforms want these combined into a single file, while others require them separate. Understanding this flexibility is key to successful installation.

For example, nginx typically wants the certificate and chain combined:

```
-----BEGIN CERTIFICATE-----
(end-entity certificate content)
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
(intermediate certificate content)
-----END CERTIFICATE-----
```

Apache, by contrast, often prefers them separate but referenced in the configuration file.

### Installing Exported Certificates on Linux Servers

Let's walk through installing an exported certificate on a Linux server running nginx, one of the most common scenarios.

After exporting your certificate and chain from ACM Private CA, you have a PEM file containing both the end-entity and intermediate certificates. You also need the private key, which you export separately from ACM Private CA (the `GetCertificateAndCsr` or similar API if using the private CA's own API, or through your certificate management system that originally created the request).

First, place the certificate file and private key in the appropriate directory. Most Linux systems store these in `/etc/ssl/certs/` and `/etc/ssl/private/` respectively. Make sure to set proper permissions:

```bash
sudo chmod 644 /etc/ssl/certs/certificate.pem
sudo chmod 600 /etc/ssl/private/private.key
```

That `600` permission on the private key is critical—only the root user should be able to read it.

For nginx, your server block configuration would look something like:

```nginx
server {
    listen 443 ssl http2;
    server_name internal.example.com;

    ssl_certificate /etc/ssl/certs/certificate.pem;
    ssl_certificate_key /etc/ssl/private/private.key;

    # Additional SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Your location blocks and other directives...
}
```

Apache follows a similar pattern:

```apache
<VirtualHost *:443>
    ServerName internal.example.com

    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/certificate.pem
    SSLCertificateKeyFile /etc/ssl/private/private.key
    SSLCertificateChainFile /etc/ssl/certs/chain.pem

    # Your DocumentRoot and other directives...
</VirtualHost>
```

Notice that Apache separates the chain into its own directive, while nginx combines them. This distinction matters when you're troubleshooting.

After updating the configuration, test it before reloading:

```bash
# For nginx
sudo nginx -t

# For Apache
sudo apachectl configtest
```

If the tests pass, reload the service:

```bash
# For nginx
sudo systemctl reload nginx

# For Apache
sudo systemctl reload apache2
```

### Installing Certificates in Java Keystores

Java applications use a different certificate storage mechanism called keystores. Rather than working with files directly, Java imports certificates into a binary keystore file that the JVM loads at startup.

To import an exported certificate into a Java keystore, you'll use the `keytool` utility, which comes with every Java installation. The process involves creating the keystore, then importing both the certificate chain and private key.

First, if you don't already have a keystore, create one:

```bash
keytool -genkey -alias tomcat -keyalg RSA -keysize 2048 -keystore keystore.jks -storepass changeit
```

If you're importing an existing certificate, you'll need the certificate and its corresponding private key. Java's keytool can't import a private key directly in PEM format—you need to convert it to PKCS12 format first:

```bash
openssl pkcs12 -export \
  -in certificate.pem \
  -inkey private.key \
  -out certificate.p12 \
  -name tomcat \
  -passout pass:changeit
```

This command combines the certificate and private key into a PKCS12 file with the password `changeit`. Then import this into your Java keystore:

```bash
keytool -importkeystore \
  -srckeystore certificate.p12 \
  -srcstoretype PKCS12 \
  -srcstorepass changeit \
  -destkeystore keystore.jks \
  -deststoretype JKS \
  -deststorepass changeit \
  -alias tomcat
```

You'll also want to import the root CA certificate so Java can validate the chain:

```bash
keytool -import \
  -alias root-ca \
  -file root-ca.pem \
  -keystore keystore.jks \
  -storepass changeit \
  -noprompt
```

In your Java application (say, Tomcat), configure the keystore in your server.xml:

```xml
<Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"
    maxThreads="150" SSLEnabled="true"
    keystoreFile="/path/to/keystore.jks"
    keystorePass="changeit"
    keyAlias="tomcat" />
```

### Installing Certificates on Windows Servers

Windows uses its own certificate store, distinct from the filesystem-based approach used by Linux. You can import certificates through the Certificates Management Console (certlm.msc) or programmatically using PowerShell.

For a manual import, open the Certificates Management Console on your Windows Server:

1. Press Win+R, type `certlm.msc`, and press Enter
2. Navigate to Personal > Certificates
3. Right-click and select "All Tasks" > "Import"
4. Follow the wizard, selecting your certificate file (PEM format works)
5. Ensure the private key is included and that you're importing to the correct store

If you prefer automation, PowerShell gives you fine-grained control:

```powershell
# Import the certificate and private key
$pfxPassword = ConvertTo-SecureString -String "YourPassword" -AsPlainText -Force
Import-PfxCertificate -FilePath "C:\certificate.pfx" `
  -CertStoreLocation "Cert:\LocalMachine\My" `
  -Password $pfxPassword
```

Note that this requires a PKCS12 (.pfx) file rather than PEM. You can convert PEM to PKCS12 on Windows using OpenSSL:

```powershell
openssl pkcs12 -export `
  -in certificate.pem `
  -inkey private.key `
  -out certificate.pfx `
  -passout pass:YourPassword
```

For IIS (Internet Information Services), after importing the certificate, bind it to your site:

1. Open IIS Manager
2. Select your site
3. Click "Bindings" in the right panel
4. Click "Add" and select HTTPS
5. Select your certificate from the dropdown

### Troubleshooting Certificate Validation Errors

Even with careful setup, certificate validation errors are common when first exporting and installing certificates. Let me walk through the most frequent issues and how to diagnose them.

**Certificate chain validation failures** are the most common problem. This usually manifests as a browser warning saying the certificate issuer is untrusted. The root cause is almost always that the intermediate or root certificate from your private CA isn't available to the client. When a client connects to your server and receives the end-entity certificate, it must validate the chain up to a trusted root. If intermediate certificates are missing, validation fails even if the root is trusted.

To verify the chain, use OpenSSL:

```bash
openssl verify -CAfile root-ca.pem -untrusted intermediate.pem certificate.pem
```

If this command returns "ok", your chain is valid. If it returns an error, you're missing a certificate or have the wrong one. Make sure you're including the complete chain file in your server configuration.

**Hostname mismatch errors** occur when the certificate's Common Name (CN) or Subject Alternative Name (SAN) doesn't match the hostname clients are using. If you issued a certificate for `internal.example.com` but clients are connecting to `10.0.0.1`, validation will fail. Check the certificate's details:

```bash
openssl x509 -in certificate.pem -text -noout | grep -A1 "Subject Alternative Name"
```

If you see a mismatch, you'll need to issue a new certificate with the correct hostname. You can't modify an existing certificate—you must reissue.

**Private key mismatches** are subtle but critical. The certificate and private key must match exactly. If somehow you've paired the wrong private key with a certificate, every connection will fail with a cryptographic error. To verify they match:

```bash
# Get the modulus from the certificate
openssl x509 -in certificate.pem -noout -modulus | md5sum

# Get the modulus from the private key
openssl rsa -in private.key -noout -modulus | md5sum
```

If the MD5 hashes are identical, they match. If they differ, you've got the wrong key.

**Certificate expiration** is another obvious but often overlooked issue. Private CA certificates can have long validity periods, but they eventually expire. Check the expiration date:

```bash
openssl x509 -in certificate.pem -noout -dates
```

If your certificate is expired or will expire soon, request a new one from your private CA.

**Permissions issues** on Linux often prevent the web server from reading the private key. If the key file is owned by root but nginx runs as the `www-data` user, it can't read the key. Ensure the server process has read access:

```bash
ls -la /etc/ssl/private/private.key
```

The key should be readable by the user running your web server process.

**Mixed certificate and chain content** happens when you accidentally combine certificates incorrectly. Some people paste the private key into the certificate file, which breaks everything. Keep these separate. The certificate file should contain only certificates (between `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` markers), and the key file should contain only the private key (between `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`).

### Best Practices for Certificate Management

Working with exported certificates introduces complexity that AWS's managed services abstract away. To keep your sanity, adopt these practices:

**Maintain a certificate inventory.** Keep track of where every exported certificate is deployed, when it expires, and what it's used for. A simple spreadsheet with certificate CN, deployment location, expiration date, and last update date will save you from emergency certificate expirations at 2 AM.

**Automate renewal workflows.** Private CA certificates don't auto-renew like AWS's public certificates. You need to manually request new certificates before the old ones expire. Build automation that alerts you 30 days before expiration and ideally triggers new certificate requests automatically.

**Store private keys securely.** Never commit private keys to version control. Never email them. Use your organization's secrets management system—AWS Secrets Manager, HashiCorp Vault, or similar. If someone needs a private key, they should retrieve it from a secure location, not a shared drive or email.

**Test the import process.** Before you're in a crisis with an expiring certificate, practice the import process on non-production systems. Familiarity with the tooling makes real deployments much faster and less error-prone.

**Document certificate locations.** Future you—and your team members—need to know where certificates are stored. Document the exact paths, ownership, and permissions for every deployed certificate.

### Conclusion

Exporting certificates from AWS Certificate Manager for use outside AWS is entirely possible, but it requires understanding the distinction between public and private certificates. Public certificates are locked into AWS's ecosystem for security reasons, but private certificates issued through AWS Certificate Manager Private Certificate Authority can be freely exported and deployed anywhere.

The export process itself is straightforward through the GetCertificate API, but successful deployment requires attention to certificate chains, proper file formats for your specific platform, and careful key management. Whether you're installing on nginx, Apache, Java, or Windows, the core principles remain the same: ensure the complete chain is present, verify private keys match their certificates, check hostname validity, and maintain careful inventory of what's deployed where.

As your infrastructure spans across AWS and non-AWS systems, this capability becomes invaluable. The key is treating exported certificates as the security-critical assets they truly are—which means respecting them throughout their lifecycle, from issuance through secure storage, deployment, and eventual rotation.
