#!/usr/bin/env bash
set -euo pipefail

region="${AWS_DEFAULT_REGION:-us-east-1}"
dlq_name="wager-transactions-dlq.fifo"
queue_name="wager-transactions.fifo"
events_name="wager-events.fifo"

awslocal sqs create-queue \
  --region "$region" \
  --queue-name "$dlq_name" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

dlq_url="$(awslocal sqs get-queue-url --region "$region" --queue-name "$dlq_name" --query QueueUrl --output text)"
dlq_arn="$(awslocal sqs get-queue-attributes --region "$region" --queue-url "$dlq_url" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

attributes="$(printf '{"FifoQueue":"true","ContentBasedDeduplication":"true","VisibilityTimeout":"30","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"3\\"}"}' "$dlq_arn")"

awslocal sqs create-queue \
  --region "$region" \
  --queue-name "$queue_name" \
  --attributes "$attributes"

awslocal sqs create-queue \
  --region "$region" \
  --queue-name "$events_name" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

# Compose must not start the application replicas until every required queue exists.
touch /tmp/wagering-sqs-ready
