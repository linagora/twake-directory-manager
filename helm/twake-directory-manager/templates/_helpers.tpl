{{- define "tdm.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "tdm.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- with .Values.image.registry -}}
{{ . }}/{{ $.Values.image.repository }}:{{ $tag }}
{{- else -}}
{{ .Values.image.repository }}:{{ $tag }}
{{- end -}}
{{- end -}}

{{/* The URL the OIDC provider redirects back to. */}}
{{- define "tdm.baseUrl" -}}
{{- if .Values.oidc.baseUrl -}}
{{ .Values.oidc.baseUrl }}
{{- else if and .Values.ingress.enabled .Values.ingress.hostname -}}
https://{{ .Values.ingress.hostname }}
{{- else -}}
{{ required "oidc.baseUrl is required when no ingress hostname gives it" .Values.oidc.baseUrl }}
{{- end -}}
{{- end -}}

{{- define "tdm.secretName" -}}
{{- .Values.secrets.existingSecret | default (printf "%s-env" (include "tdm.fullname" .)) -}}
{{- end -}}
