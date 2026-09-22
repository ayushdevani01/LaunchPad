package repository

import (
	"context"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudformation"
	cf "github.com/aws/aws-sdk-go-v2/service/cloudformation/types"
)

// StackFailure returns actionable failure reasons without logging resource
// properties or NoEcho parameters, which may contain application secrets.
func StackFailure(client *cloudformation.Client, name string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := client.DescribeEvents(ctx, &cloudformation.DescribeEventsInput{StackName: &name, Filters: &cf.EventFilter{FailedEvents: aws.Bool(true)}})
	if err != nil {
		return "inspect CloudFormation events for " + name
	}
	var reasons []string
	for _, event := range out.OperationEvents {
		reason := aws.ToString(event.ValidationStatusReason)
		if reason == "" {
			reason = aws.ToString(event.ResourceStatusReason)
		}
		if reason != "" {
			reasons = append(reasons, aws.ToString(event.LogicalResourceId)+": "+reason)
		}
		if len(reasons) >= 4 {
			break
		}
	}
	if len(reasons) == 0 {
		return "inspect CloudFormation events for " + name
	}
	return strings.Join(reasons, "; ")
}
