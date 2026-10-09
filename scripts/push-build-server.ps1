param([string]$Profile = 'Launchpad', [string]$Region = 'ap-south-1')
$ErrorActionPreference = 'Stop'
$recentAws = Join-Path $env:LOCALAPPDATA 'Programs/Amazon/AWSCLIV2/aws.exe'
$aws = if (Test-Path -LiteralPath $recentAws) { $recentAws } else { (Get-Command aws).Source }
$repository = & $aws ecr describe-repositories --repository-names launchpad-build-worker --query 'repositories[0].repositoryUri' --output text --profile $Profile --region $Region --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'Cannot read ECR repository. Check your AWS login.' }
$registry = ($repository.Trim() -split '/')[0]
$password = & $aws ecr get-login-password --profile $Profile --region $Region
if ($LASTEXITCODE -ne 0) { throw 'ECR authentication failed.' }
$password | docker login --username AWS --password-stdin $registry
$password = $null
if ($LASTEXITCODE -ne 0) { throw 'Docker login failed.' }
docker buildx build --platform linux/arm64 --provenance=false --tag "$($repository.Trim()):latest" --push (Join-Path $PSScriptRoot 'build-server')
if ($LASTEXITCODE -ne 0) { throw 'Worker image build/push failed. Existing builds keep their current image.' }
Write-Host 'Worker image published. New Fargate tasks will pull it automatically.'
