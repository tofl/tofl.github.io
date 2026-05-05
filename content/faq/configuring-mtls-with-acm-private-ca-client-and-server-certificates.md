---
title: "Configuring mTLS with ACM Private CA: Client and Server Certificates"
---

## Configuring mTLS with ACM Private CA: Client and Server Certificates

Securing communication between services isn't just about encrypting data in transit anymore—it's about making sure both sides of a conversation can verify each other's identity. That's where mutual TLS (mTLS) comes in. Unlike standard TLS where only the server proves who it is, mTLS requires both the client and server to authenticate to each other using certificates. When you're running a distributed system on AWS, this becomes a critical security boundary between microservices, especially when they're handling sensitive data.

AWS Certificate Manager Private CA (ACM Private CA) makes implementing mTLS significantly easier than managing your own certificate authority. Instead of running a CA infrastructure yourself, you get a managed service that handles certificate issuance, revocation, and compliance. In this guide, we'll walk through the entire process of setting up mTLS—from creating your private CA and issuing certificates, to validating certificate chains and configuring real applications to enforce mutual authentication.

### Understanding mTLS and Why It Matters

Before diving into implementation, let's clarify what mTLS actually does and why you'd want it. In a standard TLS handshake, the client verifies the server's certificate—making sure the server is who it claims to be. The server doesn't verify the client. This is fine for public web services where anyone can connect, but it's problematic in internal service-to-service communication. If your order service needs to call your payment service, shouldn't the payment service verify that the request is actually coming from your order service and not from some compromised application in your network?

mTLS flips this around. Both parties present certificates and verify each other. The client proves its identity to the server, and the server proves its identity to the client. For distributed systems, this creates a security model where services can't impersonate each other, and if a certificate is compromised, you can revoke it without requiring a code deployment everywhere.

The challenge is that managing certificates at scale—issuing them, rotating them before expiration, maintaining the certificate chain—becomes a significant operational burden. ACM Private CA abstracts this away. You don't manage key material directly; AWS stores the private keys in hardware security modules (HSMs) and handles the mechanics of certificate issuance.

### Setting Up ACM Private CA

Your first step is creating a private certificate authority. This CA will issue all the certificates for your services. You have two architecture choices: a root CA that issues certificates directly, or a more hierarchical approach where a root CA issues an intermediate CA, which then issues end-entity certificates. For production systems, the hierarchical approach is strongly recommended because you can keep the root CA offline, exposing only the intermediate CA to the network. This limits the blast radius if the intermediate is compromised.

Let's start by creating a root CA using the AWS Management Console or CLI. Here's the CLI approach:

```bash
aws acm-pca create-certificate-authority \
  --certificate-authority-configuration \
    KeyAlgorithm=RSA_2048,\
    SigningAlgorithm=SHA256WITHRSA,\
    Subject="{
      C=US,
      ST=California,
      L=San Francisco,
      O=MyOrganization,
      CN=My-Root-CA
    }" \
  --certificate-authority-type ROOT \
  --region us-east-1
```

This creates the CA but doesn't activate it yet. Once created, you need to get a certificate signing request from the CA and sign it with itself (self-signed), then import that certificate back:

```bash
# Get the CSR
aws acm-pca get-certificate-authority-csr \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012 \
  --output text > ca.csr

# Issue a self-signed root certificate (valid for 10 years)
aws acm-pca issue-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012 \
  --csr fileb://ca.csr \
  --signing-algorithm SHA256WITHRSA \
  --template-arn arn:aws:acm-pca:::template/RootCACertificate/V1 \
  --validity Value=3650,Type=DAYS

# This returns a CertificateArn - get the certificate
aws acm-pca get-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012 \
  --certificate-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012/certificate/abcdef1234567890 \
  --output text > root_ca.crt

# Import the certificate back to activate the CA
aws acm-pca import-certificate-authority-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/12345678-1234-1234-1234-123456789012 \
  --certificate fileb://root_ca.crt
```

Once your root CA is created, you'd typically create a subordinate (intermediate) CA. The intermediate CA will be the one actually issuing end-entity certificates. This is the same process, but you specify `SUBORDINATE` as the type and sign the intermediate's CSR with the root CA instead of itself.

### Issuing Client and Server Certificates

With your CA hierarchy in place, issuing certificates is straightforward. Each certificate needs to specify whether it's a server certificate (used for the service listening for connections) or a client certificate (used by the service initiating connections). In practice, this distinction is just a template and some extensions—the actual cryptography is identical.

Let's say you have two services: `order-service` and `payment-service`. The order service needs to make requests to the payment service, so it needs a client certificate. The payment service needs a server certificate.

Issuing a server certificate for the payment service:

```bash
aws acm-pca request-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/intermediate-ca-arn \
  --csr fileb://payment-service.csr \
  --signing-algorithm SHA256WITHRSA \
  --template-arn arn:aws:acm-pca:::template/EndEntityServerAuthCertificate/V1 \
  --validity Value=365,Type=DAYS
```

The key here is the template: `EndEntityServerAuthCertificate/V1` includes the `serverAuth` extended key usage (EKU), which marks the certificate as suitable for server authentication.

For the order service's client certificate, you'd use `EndEntityClientAuthCertificate/V1`:

```bash
aws acm-pca request-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/intermediate-ca-arn \
  --csr fileb://order-service.csr \
  --signing-algorithm SHA256WITHRSA \
  --template-arn arn:aws:acm-pca:::template/EndEntityClientAuthCertificate/V1 \
  --validity Value=365,Type=DAYS
```

The CSR (certificate signing request) comes from your application. Typically, you'd generate a private key and CSR on the machine where the certificate will be used, or you'd generate it during service initialization. For services running in containers (like ECS), you might generate keys at container startup or mount them from AWS Secrets Manager.

### Understanding Certificate Chains and Root Trust

Here's where many developers stumble: when a certificate is issued by an intermediate CA, the certificate chain matters. When you present your server certificate to a client, the client needs not just the server's certificate, but also the intermediate CA's certificate that signed it. Without the complete chain, the client can't validate that the certificate was issued by a trusted CA.

Think of it like a notarized letter. The letter is signed by a notary, but for the signature to be verified, the recipient needs to know that the notary itself is authorized. The notary's authorization comes from a higher authority, which ultimately traces back to someone you trust (the root).

AWS ACM Private CA handles this elegantly. When you issue a certificate, you get three things:

The end-entity certificate (your service's certificate), the intermediate CA certificate (which signed the end-entity certificate), and the root CA certificate. Together, these form the complete chain.

When configuring your service, you need to:

1. Install the private key for your service's certificate in the application (either directly or via a key management service)
2. Install the complete chain (end-entity + intermediate + root) where clients will validate it
3. Configure the application to present the full chain when establishing connections
4. Configure clients to trust the root CA certificate

For example, in Go, you might build a TLS configuration like this:

```go
// Load the server certificate and private key
cert, err := tls.LoadX509KeyPair("server.crt", "server.key")
if err != nil {
    log.Fatal(err)
}

// Load the root CA certificate for validating client certificates
rootCertPEM, err := ioutil.ReadFile("root_ca.crt")
if err != nil {
    log.Fatal(err)
}
rootCert, err := x509.ParseCertificate(der)
if err != nil {
    log.Fatal(err)
}
rootCAs := x509.NewCertPool()
rootCAs.AddCert(rootCert)

// Configure TLS with mutual authentication
tlsConfig := &tls.Config{
    Certificates: []tls.Certificate{cert},
    ClientAuth:   tls.RequireAndVerifyClientCert,
    ClientCAs:    rootCAs,
    MinVersion:   tls.VersionTLS12,
}

// Use tlsConfig for the server listener
```

On the client side:

```go
// Load the client certificate and private key
clientCert, err := tls.LoadX509KeyPair("client.crt", "client.key")
if err != nil {
    log.Fatal(err)
}

// Load the root CA to verify the server's certificate
rootCertPEM, err := ioutil.ReadFile("root_ca.crt")
if err != nil {
    log.Fatal(err)
}
rootCert, err := x509.ParseCertificate(der)
if err != nil {
    log.Fatal(err)
}
rootCAs := x509.NewCertPool()
rootCAs.AddCert(rootCert)

// Configure TLS with client certificate and server verification
tlsConfig := &tls.Config{
    Certificates: []tls.Certificate{clientCert},
    RootCAs:      rootCAs,
    MinVersion:   tls.VersionTLS12,
}

// Make requests using this TLS configuration
client := &http.Client{
    Transport: &http.Transport{
        TLSClientConfig: tlsConfig,
    },
}
```

The critical insight: the client needs the root CA certificate to verify the server's certificate, and the server needs the root CA certificate to verify the client's certificate. Both sides need to trust the same root.

### Configuring mTLS in AWS Services

Different AWS services handle mTLS configuration differently. Let's walk through a few common scenarios.

#### Application Load Balancer (ALB) with Client Certificate Authentication

ALBs can enforce client certificate validation if you're terminating TLS at the load balancer. However, ALB support for client certificate authentication is somewhat limited compared to custom applications. ALBs can validate that a client certificate is present and signed by a trusted CA, but they don't easily support certificate-based authorization policies (like "only allow requests from clients with CN=order-service").

To configure it, you'd create a target group with a listener rule that validates client certificates. This requires the certificate authority's certificate chain to be installed in a way the ALB can reference it. In practice, you'd likely configure this through an HTTPS listener with mutual TLS enabled, though the full configuration options depend on your ALB version.

#### API Gateway with Client Certificate Authentication

API Gateway supports client certificates through mutual TLS authentication. You can require clients to present a valid certificate from your private CA. The configuration involves creating a mutual TLS authentication (mTLS) domain name, which routes requests to your API only if the client certificate is valid.

Setting this up:

```bash
# Create a mutual TLS authentication configuration
aws apigateway create-domain-name \
  --domain-name api.internal.example.com \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/your-cert-arn \
  --mutual-tls-authentication-source-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/your-ca-arn \
  --security-policy TLS_1_2
```

This tells API Gateway to accept only requests with a client certificate issued by your specified CA. The API Gateway validates the certificate chain automatically.

#### Custom Applications: ECS Service-to-Service Communication

This is where mTLS really shines. Imagine you have an order service and a payment service, both running in ECS. The order service needs to call the payment service. You want to ensure that only the order service can call the payment service.

First, you'd issue certificates for both services from ACM Private CA:

1. A server certificate for payment-service with CN=payment-service
2. A client certificate for order-service with CN=order-service

Both services would run as ECS tasks. At startup, they'd fetch their respective certificates and private keys (from Secrets Manager or Parameter Store, or by mounting an encrypted volume):

```python
# In payment-service
import ssl
from http.server import HTTPServer, BaseHTTPRequestHandler

# Fetch certificate from Secrets Manager
secret = boto3.client('secretsmanager').get_secret_value(SecretId='payment-service-cert')
cert_data = json.loads(secret['SecretString'])

# Write to files (in a real scenario, you'd handle this securely)
with open('/tmp/server.crt', 'w') as f:
    f.write(cert_data['certificate'])
with open('/tmp/server.key', 'w') as f:
    f.write(cert_data['private_key'])
with open('/tmp/root_ca.crt', 'w') as f:
    f.write(cert_data['root_ca'])

# Create SSL context for mTLS
context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
context.load_cert_chain('/tmp/server.crt', '/tmp/server.key')
context.load_verify_locations('/tmp/root_ca.crt')
context.verify_mode = ssl.CERT_REQUIRED

# Create HTTPS server with mTLS
server = HTTPServer(('0.0.0.0', 8443), PaymentServiceHandler)
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
```

On the order service side:

```python
import ssl
import requests

# Fetch certificate from Secrets Manager
secret = boto3.client('secretsmanager').get_secret_value(SecretId='order-service-cert')
cert_data = json.loads(secret['SecretString'])

# Write to files
with open('/tmp/client.crt', 'w') as f:
    f.write(cert_data['certificate'])
with open('/tmp/client.key', 'w') as f:
    f.write(cert_data['private_key'])
with open('/tmp/root_ca.crt', 'w') as f:
    f.write(cert_data['root_ca'])

# Configure requests to use mTLS
response = requests.post(
    'https://payment-service:8443/process-payment',
    json={'amount': 100},
    cert=('/tmp/client.crt', '/tmp/client.key'),
    verify='/tmp/root_ca.crt'
)
```

In this setup, the payment service verifies that incoming requests have a valid client certificate signed by your private CA. The order service verifies that it's actually talking to the payment service (not a man-in-the-middle imposter). Both services authenticate each other.

### Certificate Chain Validation and Common Pitfalls

Even with a managed service like ACM Private CA, certificate chain issues are surprisingly common. Let's cover the most frequent problems and how to diagnose them.

#### Missing Intermediate CA in the Chain

If you're using a hierarchical CA setup (root + intermediate + end-entity), the client must have the intermediate CA's certificate. If you only provide the root certificate, the client can't complete the validation chain. The error you'd see is something like "unable to get local issuer certificate" or "certificate chain incomplete."

When issuing a certificate, always download the complete chain:

```bash
# Get the full certificate chain
aws acm-pca get-certificate \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/ca-arn \
  --certificate-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/ca-arn/certificate/cert-arn \
  --output text > full_chain.pem
```

This gives you the end-entity certificate and the intermediate CA certificate in one file. Some tools expect them in a specific order (leaf first, then intermediate, then root), so verify the order in your configuration.

#### Expired Root CA Certificate

ACM Private CA lets you set the lifetime of your root CA. If the root CA certificate itself expires, it can no longer issue certificates, and existing certificates become unverifiable (since you can't validate the signature of the intermediate CA). This is a catastrophic failure that requires immediate remediation.

Check your root CA's expiration date:

```bash
aws acm-pca describe-certificate-authority \
  --certificate-authority-arn arn:aws:acm-pca:us-east-1:123456789012:certificate-authority/root-ca-arn

# Look for the "NotAfter" date in the response
```

Set up CloudWatch alarms to alert you 90 days before expiration. When you're approaching expiration, you need to plan a migration to a new root CA. This is non-trivial because all services need to update their trust anchors to include the new root's certificate. For critical systems, consider issuing a very long-lived root (10+ years).

#### Incorrect Certificate Subject or Extensions

Sometimes a certificate is issued correctly, but it has the wrong subject or is missing critical extensions. For example, if a server certificate is issued without the `serverAuth` extended key usage (EKU), some TLS implementations will reject it even though the signature is valid.

Always verify the certificate after issuance:

```bash
openssl x509 -in server.crt -text -noout
```

Look for:

1. The `Subject` line contains the correct common name or subject alternative names (SANs) for your service
2. The `X509v3 Extended Key Usage` section includes `TLS Web Server Authentication` for server certificates, or `TLS Web Client Authentication` for client certificates
3. The `X509v3 Subject Alternative Name` includes all the DNS names or IPs your service might be accessed by (important for servers)
4. The `Issuer` line shows your intermediate CA (or root CA if you're not using an intermediate)

#### Certificate and Private Key Mismatch

This is rare but devastating. You configure a service with a certificate and private key that don't match, and all TLS connections fail with a cryptographic error. Always verify the pair:

```bash
# Extract the public key from the certificate
openssl x509 -in server.crt -pubkey -noout > cert_pubkey.pem

# Extract the public key from the private key
openssl pkey -in server.key -pubout > key_pubkey.pem

# Compare them
diff cert_pubkey.pem key_pubkey.pem
# If the output is empty, they match
```

#### Clock Skew

TLS validation includes checking that the current time is within the certificate's `Not Before` and `Not After` dates. If a server's clock is significantly out of sync, its certificate might appear expired or not yet valid. This is especially problematic in containerized environments where multiple machines might have slight time differences.

Ensure all services use NTP for clock synchronization. In ECS, this is usually automatic, but in on-premises or hybrid environments, verify that `chronyd` or `ntpd` is running and synchronized.

### Deploying Certificates to Services

Getting certificates to services running in ECS or other container platforms requires careful handling. You don't want certificates baked into container images (since they have limited lifetimes), and you don't want them in environment variables (security risk). The best practices are:

Use AWS Secrets Manager to store the certificate, private key, and root CA certificate. Your task definition references the secret, and the container fetches it at runtime. You can configure the secret to automatically rotate every 30-60 days (coordinated with your certificate rotation).

Example IAM policy for an ECS task role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:payment-service-cert-*"
    }
  ]
}
```

In your ECS task definition, mount the secret as an environment variable or file, then have your application read it at startup.

### Monitoring and Rotating Certificates

Certificates have expiration dates, and expired certificates break your services. You need a monitoring and rotation strategy.

CloudWatch Events (EventBridge) can trigger on ACM Private CA certificate events. Set up a rule that triggers when a certificate is about to expire. A Lambda function can then automatically request a new certificate and update your services.

For simple services, you might set a certificate lifetime to 30 days and fully automate rotation. For complex services with multiple instances, you might use a longer lifetime (1-3 years) and rotate during scheduled maintenance windows.

A practical monitoring strategy:

1. Query ACM Private CA for all issued certificates and their expiration dates
2. Create a CloudWatch custom metric showing "days until expiration" for each certificate
3. Alert when any certificate has less than 30 days until expiration
4. Automate certificate re-issuance and service updates

### Practical Considerations and Performance

mTLS adds a small amount of latency to every connection (during the TLS handshake). For service-to-service communication, this is usually negligible (a few milliseconds), but in high-frequency, low-latency scenarios, measure the impact.

TLS session resumption can reduce this latency. If two services communicate frequently, the TLS handshake can be reused across multiple requests. Most modern TLS libraries handle this automatically, but ensure you're not creating a new connection for every request.

Certificate validation can also be CPU-intensive at scale. If a service receives thousands of concurrent requests, validating thousands of client certificates simultaneously might impact performance. For most use cases, this isn't a concern, but in extremely high-scale systems, consider whether you're validating certificates only at the edge (load balancer) and trusting traffic within your network.

### Conclusion

mTLS with ACM Private CA provides a managed, scalable way to secure service-to-service communication without the operational burden of running your own certificate authority. The key to successful implementation is understanding the certificate chain—both the client and server must trust the same root, and the complete chain must be available for validation.

The most common problems stem from incomplete certificate chains, expired root CAs, or clock skew, all of which can be prevented with proper monitoring and automation. Start by setting up a simple two-tier CA hierarchy (root + intermediate), issue certificates with the appropriate templates, and configure your services to present the complete chain. As you scale, invest in automation for certificate rotation and monitoring.

The payoff is substantial: your services can be sure they're talking to the right peers, unauthorized services can't impersonate legitimate ones, and if a certificate is compromised, you can revoke it without touching your code. That's a significant security improvement for the operational complexity of certificate management, which ACM Private CA handles for you.
