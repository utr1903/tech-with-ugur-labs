{{- define "chatbot-server.name" -}}
chatbot-server
{{- end -}}

{{- define "chatbot-server.labels" -}}
app.kubernetes.io/name: {{ include "chatbot-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
