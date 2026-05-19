{{- define "ranking.name" -}}
{{- .Chart.Name }}
{{- end }}

{{- define "ranking.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "ranking.labels" -}}
app.kubernetes.io/name: {{ include "ranking.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
