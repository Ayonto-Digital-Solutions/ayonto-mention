#Requires -Version 7.0
<#
.SYNOPSIS
    Creates the ayonto_mentionevent table in a Dataverse development environment,
    or proves that the one already there is the one this product expects.

.DESCRIPTION
    This is a provisioning aid for the one step that cannot happen in this
    repository: the table has to exist in a real Dataverse environment before it
    can be exported, and the export is what ships. Nothing here authors solution
    XML, and nothing here is the source of truth. The exported SolutionPackager
    source is.

    The script is deliberately dull about what it will do:

      absent      -> create exactly the schema below, in the named solution
      present and exact  -> say so and change nothing
      present and different -> fail closed, print the differences, change nothing

    It never deletes a table, never recreates one, never changes ownership,
    never creates an environment, never creates a second solution to author in,
    and never creates a lookup. If Dataverse refuses the write because the only
    available layer of the target solution is managed, that refusal is the
    answer and the script stops with it.

    No tenant, environment, customer or connection value appears in this file.
    The environment comes from the Power Platform CLI authentication profile the
    operator has already selected.

.PARAMETER SolutionUniqueName
    The unmanaged solution the new components are added to. Metadata writes send
    it as the MSCRM.SolutionUniqueName header, which is the documented way to
    associate a solution component with a solution.

.PARAMETER EnvironmentUrl
    Optional. The Dataverse organization URL. Read from the active CLI profile
    (pac env who --json) when not given.

.PARAMETER AccessToken
    Optional. A bearer token for the Dataverse Web API of that organization.
    Obtained from `pac auth token` when not given. It is never written to the
    console, to a file, or into an error message.

.PARAMETER VerifyOnly
    Read and compare only. Never writes, whatever the environment contains.

.EXAMPLE
    pac auth select --index 1
    pac env who
    ./Initialize-MentionEventSchema.ps1 -VerifyOnly
    ./Initialize-MentionEventSchema.ps1

.NOTES
    Microsoft Learn, verified before this was written:

    Create and update table definitions using the Web API
      POST EntityDefinitions, attributes may be included in the Attributes array
      at creation, and "you can associate them with a solution by using the
      MSCRM.SolutionUniqueName optional request header".
      https://learn.microsoft.com/power-apps/developer/data-platform/webapi/create-update-entity-definitions-using-web-api

    Create and update column definitions using the Web API
      the creatable column types and their exact JSON shapes.
      https://learn.microsoft.com/power-apps/developer/data-platform/webapi/create-update-column-definitions-using-web-api

    Column definitions
      the type table with its "Can Create" column. UniqueidentifierType says No,
      which is why every identifier below is a string. Also: "Custom columns
      can't be set to use the SystemRequired option" and "Dataverse doesn't
      return an error when a column with ApplicationRequired applied doesn't
      have a value" — the required contract belongs to the server ingest.
      https://learn.microsoft.com/power-apps/developer/data-platform/entity-attribute-metadata

    Customize table definitions
      https://learn.microsoft.com/power-apps/developer/data-platform/customize-entity-metadata

    pac auth / pac env
      `pac auth token` displays an access token for the selected profile;
      `pac env who --json` returns the current organization as JSON.
      https://learn.microsoft.com/power-platform/developer/cli/reference/auth
      https://learn.microsoft.com/power-platform/developer/cli/reference/env
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateNotNullOrEmpty()]
    [string] $SolutionUniqueName = 'AyontoMention',

    [string] $EnvironmentUrl,

    [string] $AccessToken,

    [switch] $VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ApiVersion = 'v9.2'
$script:LanguageCode = 1033

# ---------------------------------------------------------------------------
# The schema. One declaration, used to create, to compare and to report.
# ---------------------------------------------------------------------------

$script:Table = [ordered]@{
    SchemaName          = 'ayonto_MentionEvent'
    LogicalName         = 'ayonto_mentionevent'
    EntitySetName       = 'ayonto_mentionevents'
    DisplayName         = 'Mention'
    DisplayCollection   = 'Mentions'
    Description         = 'One mention episode for one recipient, with the notification configuration that applied when it was created.'
    OwnershipType       = 'OrganizationOwned'
    PrimaryNameSchema   = 'ayonto_Name'
    PrimaryNameLength   = 200
}

# Identifiers are strings because Dataverse does not allow a custom
# Uniqueidentifier column. 36 is the canonical hyphenated lowercase GUID form
# and nothing else: a braced or parenthesised value does not fit, which makes
# the length itself a check. The server ingest parses and normalises with
# Guid.ToString("D") before it writes, and rejects anything it cannot parse.
$script:GuidLength = 36

# Required here means ApplicationRequired. Dataverse does not enforce it — see
# the note in .NOTES — so this is a statement of intent that model-driven apps
# honour, while the ingest does the actual refusing.
$script:Columns = @(
    # --- identity -----------------------------------------------------------
    [pscustomobject]@{ Schema = 'ayonto_EventId';            Kind = 'String'; Length = $script:GuidLength; Required = $true;  Display = 'Event id';             Description = 'Mention episode identifier, canonical lowercase GUID.' }
    [pscustomobject]@{ Schema = 'ayonto_RecordTable';        Kind = 'String'; Length = 128;                Required = $true;  Display = 'Record table';         Description = 'Logical name of the table the mention was written on.' }
    [pscustomobject]@{ Schema = 'ayonto_RecordId';           Kind = 'String'; Length = $script:GuidLength; Required = $true;  Display = 'Record id';            Description = 'Identifier of the business row, canonical lowercase GUID.' }
    [pscustomobject]@{ Schema = 'ayonto_SourceField';        Kind = 'String'; Length = 128;                Required = $true;  Display = 'Source field';         Description = 'Logical name of the text column the mention was written in.' }
    [pscustomobject]@{ Schema = 'ayonto_RecipientUserId';    Kind = 'String'; Length = $script:GuidLength; Required = $true;  Display = 'Recipient user id';    Description = 'Identifier of the mentioned user, canonical lowercase GUID.' }
    [pscustomobject]@{ Schema = 'ayonto_InitiatingUserId';   Kind = 'String'; Length = $script:GuidLength; Required = $true;  Display = 'Initiating user id';   Description = 'Identifier of the user whose save created the event, from the trusted execution context.' }

    # --- configuration snapshot --------------------------------------------
    [pscustomobject]@{ Schema = 'ayonto_ConfigSchemaVersion'; Kind = 'Integer'; Required = $true; Display = 'Configuration schema version'; Description = 'Shape of the notification configuration snapshot carried by this row.' }

    [pscustomobject]@{ Schema = 'ayonto_EmailEnabled';       Kind = 'Boolean'; Required = $true;  Display = 'Email enabled';        Description = 'Whether email was enabled for this field when the event was created.' }
    [pscustomobject]@{ Schema = 'ayonto_EmailSubject';       Kind = 'String'; Length = 4000;      Required = $false; Display = 'Email subject';        Description = 'Subject for the email notification.' }
    [pscustomobject]@{ Schema = 'ayonto_EmailBody';          Kind = 'Memo';   Length = 100000;    Required = $false; Display = 'Email message';        Description = 'Message body for the email notification.' }
    [pscustomobject]@{ Schema = 'ayonto_EmailLinkText';      Kind = 'String'; Length = 4000;      Required = $false; Display = 'Email link text';      Description = 'Link text for the email notification.' }

    [pscustomobject]@{ Schema = 'ayonto_TeamsEnabled';       Kind = 'Boolean'; Required = $true;  Display = 'Teams enabled';        Description = 'Whether Teams was enabled for this field when the event was created.' }
    [pscustomobject]@{ Schema = 'ayonto_TeamsTitle';         Kind = 'String'; Length = 4000;      Required = $false; Display = 'Teams title';          Description = 'Title for the Teams notification.' }
    [pscustomobject]@{ Schema = 'ayonto_TeamsBody';          Kind = 'Memo';   Length = 100000;    Required = $false; Display = 'Teams message';        Description = 'Message body for the Teams notification.' }
    [pscustomobject]@{ Schema = 'ayonto_TeamsLinkText';      Kind = 'String'; Length = 4000;      Required = $false; Display = 'Teams link text';      Description = 'Link text for the Teams notification.' }

    [pscustomobject]@{ Schema = 'ayonto_InAppEnabled';       Kind = 'Boolean'; Required = $true;  Display = 'In-app enabled';       Description = 'Whether in-app notification was enabled for this field when the event was created.' }
    [pscustomobject]@{ Schema = 'ayonto_InAppTitle';         Kind = 'String'; Length = 4000;      Required = $false; Display = 'In-app title';         Description = 'Title for the in-app notification.' }
    [pscustomobject]@{ Schema = 'ayonto_InAppBody';          Kind = 'Memo';   Length = 100000;    Required = $false; Display = 'In-app message';       Description = 'Message body for the in-app notification.' }
    [pscustomobject]@{ Schema = 'ayonto_InAppLinkText';      Kind = 'String'; Length = 4000;      Required = $false; Display = 'In-app link text';     Description = 'Link text for the in-app notification.' }
)

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

function Write-Step { param([string] $Message) Write-Host "  $Message" }

function Stop-Closed {
    param([string] $Message)
    throw "ayonto_mentionevent: $Message"
}

function New-Label {
    param([string] $Text)
    @{
        '@odata.type'    = 'Microsoft.Dynamics.CRM.Label'
        LocalizedLabels  = @(@{
            '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'
            Label         = $Text
            LanguageCode  = $script:LanguageCode
        })
    }
}

function New-RequiredLevel {
    param([bool] $Required)
    @{
        # SystemRequired is not available to custom columns, so the strongest
        # level a custom column can carry is ApplicationRequired.
        Value                       = $(if ($Required) { 'ApplicationRequired' } else { 'None' })
        CanBeChanged                = $true
        ManagedPropertyLogicalName  = 'canmodifyrequirementlevelsettings'
    }
}

function New-AttributePayload {
    param([psobject] $Column)

    $common = @{
        SchemaName    = $Column.Schema
        DisplayName   = New-Label -Text $Column.Display
        Description   = New-Label -Text $Column.Description
        RequiredLevel = New-RequiredLevel -Required $Column.Required
    }

    switch ($Column.Kind) {
        'String' {
            $common += @{
                '@odata.type'     = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'
                AttributeType     = 'String'
                AttributeTypeName = @{ Value = 'StringType' }
                FormatName        = @{ Value = 'Text' }
                MaxLength         = $Column.Length
            }
        }
        'Memo' {
            $common += @{
                '@odata.type'     = 'Microsoft.Dynamics.CRM.MemoAttributeMetadata'
                AttributeType     = 'Memo'
                AttributeTypeName = @{ Value = 'MemoType' }
                Format            = 'TextArea'
                MaxLength         = $Column.Length
                IsLocalizable     = $false
            }
        }
        'Integer' {
            $common += @{
                '@odata.type'     = 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata'
                AttributeType     = 'Integer'
                AttributeTypeName = @{ Value = 'IntegerType' }
                Format            = 'None'
                MinValue          = 1
                MaxValue          = 2147483647
            }
        }
        'Boolean' {
            $common += @{
                '@odata.type'     = 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata'
                AttributeType     = 'Boolean'
                AttributeTypeName = @{ Value = 'BooleanType' }
                DefaultValue      = $false
                OptionSet         = @{
                    '@odata.type'  = 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata'
                    OptionSetType  = 'Boolean'
                    TrueOption     = @{ Value = 1; Label = (New-Label -Text 'Yes') }
                    FalseOption    = @{ Value = 0; Label = (New-Label -Text 'No') }
                }
            }
        }
        default { Stop-Closed "unknown column kind '$($Column.Kind)' for $($Column.Schema)" }
    }

    return $common
}

# ---------------------------------------------------------------------------
# Environment and token. Neither is printed.
# ---------------------------------------------------------------------------

function Resolve-EnvironmentUrl {
    param([string] $Supplied)

    if ($Supplied) { return $Supplied.TrimEnd('/') }

    Write-Step 'reading the organization from the active CLI profile'
    $raw = & pac env who --json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Stop-Closed "pac env who failed. Select a profile first with 'pac auth select', or pass -EnvironmentUrl."
    }

    try { $who = $raw | ConvertFrom-Json } catch { Stop-Closed 'pac env who did not return JSON.' }

    $url = @('OrgUrl', 'FriendlyName', 'Url') |
        ForEach-Object { if ($who.PSObject.Properties.Name -contains $_) { $who.$_ } } |
        Where-Object { $_ -is [string] -and $_ -match '^https://' } |
        Select-Object -First 1

    if (-not $url) { Stop-Closed 'could not read an organization URL from pac env who --json; pass -EnvironmentUrl.' }
    return ([string] $url).TrimEnd('/')
}

function Resolve-AccessToken {
    param([string] $Supplied)

    if ($Supplied) { return $Supplied }

    $raw = & pac auth token 2>&1
    if ($LASTEXITCODE -ne 0) {
        Stop-Closed "pac auth token failed. Select a profile with 'pac auth select', or pass -AccessToken."
    }

    # The command prints a line of prose around the token in some versions, so
    # take the longest whitespace-delimited JWT-shaped run and nothing else.
    $token = ($raw -split '\s+' | Where-Object { $_ -match '^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.' } | Select-Object -First 1)
    if (-not $token) { Stop-Closed 'pac auth token returned no recognisable token.' }
    return $token
}

function Invoke-Dataverse {
    param(
        [string] $Method,
        [string] $Path,
        [hashtable] $Body,
        [switch] $AllowNotFound
    )

    $headers = @{
        Authorization    = "Bearer $script:Token"
        Accept           = 'application/json'
        'OData-Version'  = '4.0'
        'OData-MaxVersion' = '4.0'
    }
    if ($Method -in @('POST', 'PUT', 'PATCH')) {
        $headers['MSCRM.SolutionUniqueName'] = $SolutionUniqueName
    }

    $arguments = @{
        Method  = $Method
        Uri     = "$script:OrgUrl/api/data/$script:ApiVersion/$Path"
        Headers = $headers
    }
    if ($Body) {
        $arguments['Body'] = ($Body | ConvertTo-Json -Depth 20 -Compress)
        $arguments['ContentType'] = 'application/json; charset=utf-8'
    }

    try {
        return Invoke-RestMethod @arguments
    }
    catch {
        $status = $null
        if ($_.Exception.PSObject.Properties.Name -contains 'Response' -and $_.Exception.Response) {
            $status = [int] $_.Exception.Response.StatusCode
        }
        if ($AllowNotFound -and $status -eq 404) { return $null }

        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        # The token never travels into an error message.
        $detail = $detail -replace [regex]::Escape($script:Token), '<redacted>'
        Stop-Closed "$Method $Path failed with status $status`n$detail"
    }
}

# ---------------------------------------------------------------------------
# Compare what is there against what is declared
# ---------------------------------------------------------------------------

function Get-ExistingTable {
    $select = 'LogicalName,SchemaName,EntitySetName,OwnershipType,PrimaryNameAttribute,IsManaged'
    return Invoke-Dataverse -Method GET -AllowNotFound `
        -Path "EntityDefinitions(LogicalName='$($script:Table.LogicalName)')?`$select=$select"
}

function Get-ExistingColumns {
    $select = 'LogicalName,SchemaName,AttributeType,IsCustomAttribute'
    $response = Invoke-Dataverse -Method GET `
        -Path "EntityDefinitions(LogicalName='$($script:Table.LogicalName)')/Attributes?`$select=$select"
    return $response.value
}

function Compare-Against-Contract {
    param($Existing, $ExistingColumns)

    $problems = [System.Collections.Generic.List[string]]::new()

    if ($Existing.OwnershipType -ne $script:Table.OwnershipType) {
        $problems.Add("ownership is '$($Existing.OwnershipType)', expected '$($script:Table.OwnershipType)' (ownership cannot be changed after creation)")
    }
    if ($Existing.EntitySetName -ne $script:Table.EntitySetName) {
        $problems.Add("entity set is '$($Existing.EntitySetName)', expected '$($script:Table.EntitySetName)'")
    }
    if ($Existing.SchemaName -ne $script:Table.SchemaName) {
        $problems.Add("schema name is '$($Existing.SchemaName)', expected '$($script:Table.SchemaName)'")
    }

    $byLogical = @{}
    foreach ($column in $ExistingColumns) { $byLogical[$column.LogicalName] = $column }

    foreach ($column in $script:Columns) {
        $logical = $column.Schema.ToLowerInvariant()
        if (-not $byLogical.ContainsKey($logical)) {
            $problems.Add("column '$($column.Schema)' is missing")
            continue
        }
        $expectedType = switch ($column.Kind) {
            'String'  { 'String' }
            'Memo'    { 'Memo' }
            'Integer' { 'Integer' }
            'Boolean' { 'Boolean' }
        }
        $found = $byLogical[$logical].AttributeType
        if ($found -ne $expectedType) {
            $problems.Add("column '$($column.Schema)' is $found, expected $expectedType (a column type cannot be changed after creation)")
        }
    }

    # A lookup on this table would tie the product solution to a host table or
    # to systemuser, which is exactly what the architecture forbids.
    $lookups = $ExistingColumns |
        Where-Object { $_.IsCustomAttribute -and $_.AttributeType -in @('Lookup', 'Customer', 'Owner') }
    foreach ($lookup in $lookups) {
        $problems.Add("custom lookup column '$($lookup.SchemaName)' exists; this table must carry no lookups")
    }

    $expected = $script:Columns.Schema.ToLowerInvariant()
    $unexpected = $ExistingColumns |
        Where-Object { $_.IsCustomAttribute -and $_.LogicalName -notin $expected -and $_.LogicalName -ne $script:Table.PrimaryNameSchema.ToLowerInvariant() }
    foreach ($extra in $unexpected) {
        $problems.Add("unexpected custom column '$($extra.SchemaName)'")
    }

    return $problems
}

# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

function New-MentionEventTable {
    $attributes = @(
        @{
            '@odata.type'     = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'
            AttributeType     = 'String'
            AttributeTypeName = @{ Value = 'StringType' }
            SchemaName        = $script:Table.PrimaryNameSchema
            DisplayName       = New-Label -Text 'Name'
            Description       = New-Label -Text 'Readable label for this event. Not part of its identity.'
            FormatName        = @{ Value = 'Text' }
            MaxLength         = $script:Table.PrimaryNameLength
            IsPrimaryName     = $true
            # ApplicationRequired, matching what a Dataverse export shows for a
            # primary name column. Asked for explicitly so that what is created
            # and what is read back are the same thing, rather than depending on
            # a platform default this script would then have to tolerate.
            RequiredLevel     = New-RequiredLevel -Required $true
        }
    )
    foreach ($column in $script:Columns) { $attributes += (New-AttributePayload -Column $column) }

    # Belt and braces: the payload is built from a declaration that has no
    # lookup kind, and this refuses to send one even if that ever changes.
    foreach ($attribute in $attributes) {
        if ($attribute.AttributeType -in @('Lookup', 'Customer', 'Owner')) {
            Stop-Closed "refusing to create lookup column '$($attribute.SchemaName)'"
        }
    }

    $body = @{
        '@odata.type'      = 'Microsoft.Dynamics.CRM.EntityMetadata'
        SchemaName         = $script:Table.SchemaName
        DisplayName        = New-Label -Text $script:Table.DisplayName
        DisplayCollectionName = New-Label -Text $script:Table.DisplayCollection
        Description        = New-Label -Text $script:Table.Description
        OwnershipType      = $script:Table.OwnershipType
        IsActivity         = $false
        HasActivities      = $false
        HasNotes           = $false
        Attributes         = $attributes
    }

    Write-Step "creating $($script:Table.SchemaName) with $($attributes.Count) columns in solution $SolutionUniqueName"
    Invoke-Dataverse -Method POST -Path 'EntityDefinitions' -Body $body | Out-Null
}

function Publish-Table {
    $xml = "<importexportxml><entities><entity>$($script:Table.LogicalName)</entity></entities></importexportxml>"
    Write-Step 'publishing the customization'
    Invoke-Dataverse -Method POST -Path 'PublishXml' -Body @{ ParameterXml = $xml } | Out-Null
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Write-Host "ayonto_mentionevent schema bootstrap"
Write-Host "  solution: $SolutionUniqueName"

$script:OrgUrl = Resolve-EnvironmentUrl -Supplied $EnvironmentUrl
$script:Token = Resolve-AccessToken -Supplied $AccessToken

# Proves the token is for this organization's Dataverse Web API before anything
# is written. A wrong audience fails here, with nothing half-created behind it.
Write-Step 'verifying the token against WhoAmI'
$who = Invoke-Dataverse -Method GET -Path 'WhoAmI'
if (-not $who.UserId) { Stop-Closed 'WhoAmI returned no UserId; the token is not valid for this organization.' }

$existing = Get-ExistingTable

if ($null -eq $existing) {
    if ($VerifyOnly) {
        Stop-Closed 'the table does not exist, and -VerifyOnly was given.'
    }
    if (-not $PSCmdlet.ShouldProcess($script:Table.SchemaName, 'create table')) { return }

    New-MentionEventTable
    Publish-Table

    $existing = Get-ExistingTable
    if ($null -eq $existing) { Stop-Closed 'the table was created but cannot be read back.' }
}
else {
    Write-Step "the table already exists (managed: $($existing.IsManaged))"
}

$columns = Get-ExistingColumns
$problems = Compare-Against-Contract -Existing $existing -ExistingColumns $columns

if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'The table in this environment is not the table this product expects:' -ForegroundColor Red
    foreach ($problem in $problems) { Write-Host "  - $problem" -ForegroundColor Red }
    Write-Host ''
    Stop-Closed 'failing closed. Nothing was deleted, recreated or altered. Resolve this by hand and run again.'
}

$custom = @($columns | Where-Object { $_.IsCustomAttribute }).Count
Write-Host ''
Write-Host "$($script:Table.LogicalName): $($existing.OwnershipType), $custom custom column(s), set $($existing.EntitySetName)"
Write-Host 'contract holds.'
Write-Host ''
Write-Host 'Next, export and unpack the unmanaged solution, and bring the result back to the repository:'
Write-Host "  pac solution export --name $SolutionUniqueName --path ./$SolutionUniqueName.zip --managed false --overwrite"
Write-Host "  pac solution unpack --zipfile ./$SolutionUniqueName.zip --folder ./src --packagetype Unmanaged --allowDelete false"
