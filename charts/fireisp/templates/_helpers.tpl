{{/*
Expand the name of the chart.
*/}}
{{- define "fireisp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this.
*/}}
{{- define "fireisp.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "fireisp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "fireisp.labels" -}}
helm.sh/chart: {{ include "fireisp.chart" . }}
{{ include "fireisp.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels used in Deployment + Service + HPA + PDB.
*/}}
{{- define "fireisp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "fireisp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Resolve the container image tag. Source-tree installs must explicitly select a
published full commit SHA. The release workflow injects its verified semantic
version into the packaged chart after the matching image exists.
*/}}
{{- define "fireisp.image" -}}
{{- $tag := required "image.tag is required; use a published full commit SHA (release charts provide their verified release tag)" .Values.image.tag }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "fireisp.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "fireisp.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
