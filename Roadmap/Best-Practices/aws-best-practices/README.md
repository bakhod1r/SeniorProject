# AWS Best Practices

- Roadmap: https://roadmap.sh/best-practices/aws

## 1. Account, IAM and Identity
- 1.1 Use IAM Account (never root for daily work)
- 1.2 Use IAM Roles (no static credentials on EC2)
- 1.3 EC2 Roles
- 1.4 Multi-Factor Authentication on IAM
- 1.5 Group Permissions (assign permissions to groups, not users)
- 1.6 Key Management Strategy
- 1.7 Random Strings for Access Keys
- 1.8 Use Multiple API Keys per Service
- 1.9 Regular Security Audit

## 2. Networking and VPC
- 2.1 Use VPC for All Resources
- 2.2 Lock Down Security Groups
- 2.3 Configured Availability Zones Only
- 2.4 Disable SSH Access from the Internet
- 2.5 Avoid Server-Bound EIPs
- 2.6 Release Unused EIPs

## 3. Compute and Scaling
- 3.1 Scale Horizontally (not vertically)
- 3.2 Avoid Multiple Scaling Triggers
- 3.3 Scale-Down Events Handling
- 3.4 Reserved Instances for Steady Workloads
- 3.5 Termination Protection on Critical Instances
- 3.6 Pre-warm ELB for Spikes
- 3.7 ELB Health Checks
- 3.8 Application State (externalize from instance)
- 3.9 Application Changes for AWS Compatibility

## 4. Storage and S3
- 4.1 Bucket Naming for SSL Compatibility
- 4.2 CloudFront in Front of S3
- 4.3 Avoid Filesystem Mounts (EFS/FSx with care)
- 4.4 S3 Hive Results

## 5. Database and DNS
- 5.1 Configuration Endpoints (vs IPs)
- 5.2 Use Alias Records (Route 53)
- 5.3 Failover Event Subscription
- 5.4 Redundant Across AZs

## 6. Security and Encryption
- 6.1 Terminate SSL at the Edge
- 6.2 Key Management Strategy

## 7. Monitoring and Observability
- 7.1 CloudWatch Free Metrics
- 7.2 CloudWatch Custom Metrics
- 7.3 CloudWatch Detailed Monitoring
- 7.4 CloudWatch CLI Tools
- 7.5 CloudTrail (audit log)
- 7.6 Alerts as Notifications
- 7.7 Billing Alerts
- 7.8 Logs Information (what to log)
- 7.9 Tools for Logs (centralized logging)

## 8. Operations and Automation
- 8.1 Automate Everything
- 8.2 Tag Everything
- 8.3 AWS Naming Convention
- 8.4 Service Over Servers (managed services first)
- 8.5 Beware of AWS Limits
- 8.6 AWS Right Choice (pick the right service)
- 8.7 Use Official SDKs
