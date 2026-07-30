{{- define "scout.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "scout.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "scout.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "scout.labels" -}}
helm.sh/chart: {{ include "scout.chart" . }}
{{ include "scout.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "scout.selectorLabels" -}}
app.kubernetes.io/name: {{ include "scout.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "scout.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "scout.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "scout.pvcName" -}}
{{- default (printf "%s-data" (include "scout.fullname" .)) .Values.persistence.existingClaim -}}
{{- end -}}

{{- define "scout.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{/*
Volumes shared by the server and the scan. /tmp is an emptyDir because the root filesystem
is read-only, and the profile is a Secret because it is the candidate's personal data.
*/}}
{{- define "scout.volumes" -}}
- name: data
  {{- if .Values.persistence.enabled }}
  persistentVolumeClaim:
    claimName: {{ include "scout.pvcName" . }}
  {{- else }}
  emptyDir: {}
  {{- end }}
- name: tmp
  emptyDir: {}
{{- if .Values.profile.existingSecret }}
- name: profile
  secret:
    secretName: {{ .Values.profile.existingSecret }}
{{- end }}
{{- end -}}

{{- define "scout.volumeMounts" -}}
- name: data
  mountPath: /data
- name: tmp
  mountPath: /tmp
{{- if .Values.profile.existingSecret }}
- name: profile
  mountPath: /profile
  readOnly: true
{{- end }}
{{- end -}}

{{/* Secret last: a key the operator supplies out of band should win over chart config. */}}
{{- define "scout.envFrom" -}}
- configMapRef:
    name: {{ include "scout.fullname" . }}
{{- if .Values.existingSecret }}
- secretRef:
    name: {{ .Values.existingSecret }}
    optional: true
{{- end }}
{{- end -}}
