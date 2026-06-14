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

{{- define "ranking.envFrom" -}}
{{- if .Values.config.enabled }}
- configMapRef:
    name: {{ include "ranking.fullname" . }}-config
{{- end }}
{{- if .Values.secret.enabled }}
- secretRef:
    name: {{ .Values.secret.name }}
{{- end }}
{{- end }}

{{- define "ranking.coreEnv" -}}
- name: PROCESS_ROLE
  value: {{ .processRole | quote }}
- name: DATABASE_URL
  value: {{ .Values.env.DATABASE_URL | quote }}
- name: REDIS_URL
  value: {{ .Values.env.REDIS_URL | quote }}
{{- if .Values.env.DATABASE_READ_URL }}
- name: DATABASE_READ_URL
  value: {{ .Values.env.DATABASE_READ_URL | quote }}
{{- end }}
{{- if .Values.env.API_AUTH_REQUIRED }}
- name: API_AUTH_REQUIRED
  value: {{ .Values.env.API_AUTH_REQUIRED | quote }}
{{- end }}
{{- if .Values.env.KAFKA_BROKERS }}
- name: KAFKA_BROKERS
  value: {{ .Values.env.KAFKA_BROKERS | quote }}
{{- end }}
{{- if .Values.env.KAFKA_SCHEMA_REGISTRY_URL }}
- name: KAFKA_SCHEMA_REGISTRY_URL
  value: {{ .Values.env.KAFKA_SCHEMA_REGISTRY_URL | quote }}
{{- end }}
{{- if .Values.env.ELASTICSEARCH_NODE }}
- name: ELASTICSEARCH_NODE
  value: {{ .Values.env.ELASTICSEARCH_NODE | quote }}
{{- end }}
{{- if .Values.env.CLICKHOUSE_URL }}
- name: CLICKHOUSE_URL
  value: {{ .Values.env.CLICKHOUSE_URL | quote }}
{{- end }}
{{- if .Values.env.QDRANT_URL }}
- name: QDRANT_URL
  value: {{ .Values.env.QDRANT_URL | quote }}
{{- end }}
{{- if .Values.dr.region }}
- name: DR_REGION
  value: {{ .Values.dr.region | quote }}
{{- end }}
{{- if .Values.dr.cluster }}
- name: DR_CLUSTER
  value: {{ .Values.dr.cluster | quote }}
{{- end }}
{{- if .Values.productionWiring.required }}
- name: PRODUCTION_WIRING_REQUIRED
  value: "true"
{{- end }}
- name: K8S_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
{{- range $k, $v := .Values.env.extra }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end }}

{{- define "ranking.alertEnv" -}}
{{- if .Values.alerts.webhookUrl }}
- name: ALERT_WEBHOOK_URL
  value: {{ .Values.alerts.webhookUrl | quote }}
{{- end }}
{{- if .Values.alerts.webhookRoutes }}
- name: ALERT_WEBHOOK_ROUTES
  value: {{ .Values.alerts.webhookRoutes | quote }}
{{- end }}
{{- if .Values.alerts.format }}
- name: ALERT_WEBHOOK_FORMAT
  value: {{ .Values.alerts.format | quote }}
{{- end }}
{{- if .Values.alerts.cooldownSeconds }}
- name: ALERT_WEBHOOK_COOLDOWN_SECONDS
  value: {{ .Values.alerts.cooldownSeconds | quote }}
{{- end }}
{{- if .Values.alerts.pagerdutyRoutingKeySecretKey }}
- name: PAGERDUTY_ROUTING_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secret.name }}
      key: {{ .Values.alerts.pagerdutyRoutingKeySecretKey }}
      optional: true
{{- end }}
{{- end }}

{{- define "ranking.httpProbes" -}}
readinessProbe:
  httpGet:
    path: {{ .Values.probes.readinessPath | default "/health/ready" }}
    port: {{ .port }}
  initialDelaySeconds: {{ .Values.probes.readinessInitialDelaySeconds | default 10 }}
  periodSeconds: {{ .Values.probes.readinessPeriodSeconds | default 10 }}
livenessProbe:
  httpGet:
    path: {{ .Values.probes.livenessPath | default "/health" }}
    port: {{ .port }}
  initialDelaySeconds: {{ .Values.probes.livenessInitialDelaySeconds | default 30 }}
  periodSeconds: {{ .Values.probes.livenessPeriodSeconds | default 15 }}
startupProbe:
  httpGet:
    path: {{ .Values.probes.startupPath | default "/health/ready" }}
    port: {{ .port }}
  failureThreshold: {{ .Values.probes.startupFailureThreshold | default 30 }}
  periodSeconds: {{ .Values.probes.startupPeriodSeconds | default 5 }}
{{- end }}
