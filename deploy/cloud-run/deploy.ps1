[CmdletBinding()]
param(
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
    [string]$Region = 'us-central1',
    [string]$GcloudPath = 'C:/intouch/.data/google-cloud/google-cloud-sdk/bin/gcloud.cmd',
    [string]$WebOrigin,
    [ValidatePattern('^ablest-database-url:[1-9][0-9]*$')][string]$DatabaseSecret,
    [ValidatePattern('^ablest-resend-api-key:[1-9][0-9]*$')][string]$MailSecret,
    [string]$ExistingApiImage,
    [string]$ExistingWebImage,
    [switch]$PrepareOnly,
    [switch]$BuildOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$workDirectory = Join-Path $repoRoot '.data/cloud-run'
New-Item -ItemType Directory -Force $workDirectory | Out-Null
function Invoke-Gcloud([string[]]$Arguments) {
    & $GcloudPath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Google Cloud command failed: $($Arguments[0]). Stopped." }
}
function Write-Json([string]$Name, $Value) {
    $file = Join-Path $workDirectory $Name
    [IO.File]::WriteAllText($file, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    return $file
}
function Build-Image([string]$Target, [string]$Image) {
    $configuration = @{
        steps = @(@{ name = 'gcr.io/cloud-builders/docker'; args = @('build','--file','deploy/cloud-run/Dockerfile','--target',$Target,'--tag',$Image,'.') })
        images = @($Image); serviceAccount = "projects/$ProjectId/serviceAccounts/$buildAccount"
        options = @{ logging = 'CLOUD_LOGGING_ONLY' }; timeout = '1200s'
    }
    $file = Write-Json "build-$Target.json" $configuration
    Invoke-Gcloud @('builds','submit','.',"--project=$ProjectId","--region=$Region","--config=$file","--gcs-source-staging-dir=gs://$sourceBucket/source",'--quiet')
}
function Deploy-Service([string]$Name, [string]$Image, [hashtable]$Environment, [string]$Secrets = '') {
    $envFile = Write-Json "environment-$Name.json" $Environment
    $arguments = @('run','deploy',$Name,"--project=$ProjectId","--region=$Region","--image=$Image",
        "--service-account=$runtimeAccount",'--allow-unauthenticated','--ingress=all','--port=8080',
        '--cpu=1','--memory=512Mi','--cpu-throttling','--min=0','--max=2','--min-instances=0',
        '--max-instances=1','--concurrency=20','--timeout=180',"--env-vars-file=$envFile",'--quiet')
    if ($Secrets) { $arguments += "--update-secrets=$Secrets" }
    try { Invoke-Gcloud $arguments }
    finally {
        $existing = Invoke-Gcloud @('run','services','list',"--project=$ProjectId","--region=$Region","--filter=metadata.name=$Name",'--format=value(metadata.name)')
        if ($existing) { Invoke-Gcloud @('run','services','update',$Name,"--project=$ProjectId","--region=$Region",'--max=1','--quiet') }
    }
}
if ($WebOrigin -and $WebOrigin -notmatch '^https://[a-z0-9.-]+$') { throw 'WebOrigin must be an HTTPS origin without a path or trailing slash.' }
Push-Location $repoRoot
try {
    $plan = @{
        projectId=$ProjectId; region=$Region; services=@('ablest-api','ablest-web')
        database='Existing Ablest Neon database; startup applies existing idempotent schema'
        secretReferences=@($DatabaseSecret,$MailSecret); webOrigin=$WebOrigin
        minimumInstances=0; maximumInstancesPerService=1; cpu=1; memory='512Mi'
        billing='Builds, storage, logs, traffic and usage may incur charges; scaling limits are not a spending cap'
        domain='Keep Render DNS until Google preview, authentication, mail configuration and HTTPS are verified'
    }
    $planFile = Write-Json 'deployment-plan.json' $plan
    if ($PrepareOnly) { Write-Host "Prepared: $planFile. No cloud changes."; return }
    if (-not $ProjectId -or (-not $BuildOnly -and (-not $DatabaseSecret -or -not $MailSecret))) { throw 'Supply ProjectId and pinned DatabaseSecret and MailSecret references. Secret payloads are never command arguments.' }
    if (-not (Test-Path -LiteralPath $GcloudPath)) { throw 'Set GcloudPath to the existing Google Cloud CLI.' }
    $billing = (Invoke-Gcloud @('billing','projects','describe',$ProjectId,'--format=json')) | ConvertFrom-Json
    if (-not $billing.billingEnabled) { throw 'Project billing must be enabled before deployment.' }
    $uploadFiles = @(Invoke-Gcloud @('meta','list-files-for-upload'))
    $allow = '^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.dockerignore|\.gcloudignore|deploy/cloud-run/Dockerfile|postgres/schema\.sql|apps/api/(package\.json|tsconfig\.json|src/.+)|apps/web/(package\.json|tsconfig\.json|next-env\.d\.ts|next\.config\.ts|app/.+|public/.+))$'
    foreach ($file in $uploadFiles) {
        $normal = ([string]$file).Replace('\','/') -replace '^\./',''
        if ($normal -notmatch $allow -or $normal -match '(^|/)(\.env[^/]*|node_modules|\.git|\.data|backups)(/|$)') { throw "Upload rejected: $normal" }
    }
    if (-not $uploadFiles.Count) { throw 'No application files selected.' }
    Write-Host "Validated $($uploadFiles.Count) upload paths; local secrets and data excluded."
    Invoke-Gcloud @('services','enable','run.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','iam.googleapis.com','logging.googleapis.com','storage.googleapis.com','secretmanager.googleapis.com',"--project=$ProjectId",'--quiet')
    $buildAccount = "ablest-build@$ProjectId.iam.gserviceaccount.com"
    $runtimeAccount = "ablest-runtime@$ProjectId.iam.gserviceaccount.com"
    foreach ($name in @('ablest-build','ablest-runtime')) {
        $email = "$name@$ProjectId.iam.gserviceaccount.com"
        $exists = Invoke-Gcloud @('iam','service-accounts','list',"--project=$ProjectId","--filter=email:$email",'--format=value(email)')
        if (-not $exists) { Invoke-Gcloud @('iam','service-accounts','create',$name,"--project=$ProjectId",'--quiet') }
    }
    Invoke-Gcloud @('projects','add-iam-policy-binding',$ProjectId,"--member=serviceAccount:$buildAccount",'--role=roles/logging.logWriter','--condition=None','--quiet','--format=none')
    $repository = Invoke-Gcloud @('artifacts','repositories','list',"--project=$ProjectId","--location=$Region",'--filter=name:/ablest','--format=value(name)')
    if (-not $repository) { Invoke-Gcloud @('artifacts','repositories','create','ablest','--repository-format=docker',"--project=$ProjectId","--location=$Region",'--quiet') }
    Invoke-Gcloud @('artifacts','repositories','add-iam-policy-binding','ablest',"--project=$ProjectId","--location=$Region","--member=serviceAccount:$buildAccount",'--role=roles/artifactregistry.writer','--condition=None','--quiet','--format=none')
    $sourceBucket = "$ProjectId-ablest-source"
    $buckets = @(Invoke-Gcloud @('storage','buckets','list',"--project=$ProjectId",'--format=value(name)'))
    if ($buckets -notcontains $sourceBucket -and $buckets -notcontains "gs://$sourceBucket") { Invoke-Gcloud @('storage','buckets','create',"gs://$sourceBucket","--project=$ProjectId","--location=$Region",'--uniform-bucket-level-access','--public-access-prevention','--quiet') }
    Invoke-Gcloud @('storage','buckets','add-iam-policy-binding',"gs://$sourceBucket","--member=serviceAccount:$buildAccount",'--role=roles/storage.objectViewer','--quiet','--format=none')
    foreach ($reference in @($DatabaseSecret,$MailSecret) | Where-Object { $_ }) {
        $secretName = $reference.Split(':')[0]
        Invoke-Gcloud @('secrets','versions','describe',$reference.Split(':')[1],"--secret=$secretName","--project=$ProjectId",'--format=none')
        Invoke-Gcloud @('secrets','add-iam-policy-binding',$secretName,"--project=$ProjectId","--member=serviceAccount:$runtimeAccount",'--role=roles/secretmanager.secretAccessor','--condition=None','--quiet','--format=none')
    }
    $release = Get-Date -Format 'yyyyMMdd-HHmmss'
    $imageRoot = "$Region-docker.pkg.dev/$ProjectId/ablest"
    foreach ($image in @($ExistingApiImage,$ExistingWebImage)) {
        if ($image -and $image -notmatch ('^'+[regex]::Escape($imageRoot)+'/(api|web):[a-zA-Z0-9_.-]+$')) { throw 'Existing image must belong to this project and Ablest repository.' }
    }
    $apiImage = if ($ExistingApiImage) { $ExistingApiImage } else { "$imageRoot/api:$release" }
    $webImage = if ($ExistingWebImage) { $ExistingWebImage } else { "$imageRoot/web:$release" }
    if (-not $ExistingApiImage) { Build-Image 'api' $apiImage }
    if (-not $ExistingWebImage) { Build-Image 'web' $webImage }
    if ($BuildOnly) {
        $result = Write-Json 'build-result.json' @{ projectId=$ProjectId; region=$Region; apiImage=$apiImage; webImage=$webImage; release=$release }
        Write-Host "Images built; no Cloud Run services deployed. Result: $result"
        return
    }
    $canonicalOrigin = if ($WebOrigin) { $WebOrigin } else { 'https://www.ablestsolutions.com' }
    Deploy-Service 'ablest-api' $apiImage @{
        NODE_ENV='production'; HOST='0.0.0.0'; DATA_BACKEND='neon'; WEB_ORIGIN=$canonicalOrigin
        ADMIN_EMAIL='wilugo91@gmail.com'; CONTACT_FROM_EMAIL='website@mail.ablestsolutions.com'; CONTACT_TO_EMAIL='ablestdigitalsolutions@gmail.com'
    } "DATABASE_URL=$DatabaseSecret,RESEND_API_KEY=$MailSecret"
    $apiUrl = (Invoke-Gcloud @('run','services','describe','ablest-api',"--project=$ProjectId","--region=$Region",'--format=value(status.url)')).Trim()
    if ($apiUrl -notmatch '^https://[a-z0-9.-]+\.run\.app$') { throw 'Invalid API service URL.' }
    Deploy-Service 'ablest-web' $webImage @{ NODE_ENV='production'; HOSTNAME='0.0.0.0'; API_URL=$apiUrl; WEB_ORIGIN=$canonicalOrigin; SITE_URL=$canonicalOrigin }
    $webUrl = (Invoke-Gcloud @('run','services','describe','ablest-web',"--project=$ProjectId","--region=$Region",'--format=value(status.url)')).Trim()
    $health = Invoke-RestMethod "$apiUrl/v1/health" -TimeoutSec 180
    if ($health.status -ne 'ok') { throw 'API health check failed.' }
    $database = Invoke-WebRequest "$apiUrl/v1/health/database" -UseBasicParsing -TimeoutSec 180
    $projects = Invoke-WebRequest "$webUrl/api/projects" -UseBasicParsing -TimeoutSec 180
    $page = Invoke-WebRequest $webUrl -UseBasicParsing -TimeoutSec 180
    if ($database.StatusCode -ne 200 -or $projects.StatusCode -ne 200 -or $page.StatusCode -ne 200) { throw 'Preview smoke check failed.' }
    $result = Write-Json 'deployment-result.json' @{ projectId=$ProjectId; region=$Region; webUrl=$webUrl; apiUrl=$apiUrl; webOrigin=$canonicalOrigin; apiImage=$apiImage; webImage=$webImage; release=$release }
    Write-Host "Google preview ready: $webUrl. Result: $result"
    Write-Host 'Next: verify account flows, prepare domain mappings and HTTPS, then switch Hostinger DNS. Render remains available for rollback.'
} finally { Pop-Location }
