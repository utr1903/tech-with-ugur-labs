# No data sources.
#
# An earlier version read the operator's address from
# `data "google_client_openid_userinfo"`. That data source is incompatible with
# the `user_project_override` this configuration needs: the provider attaches an
# `X-Goog-User-Project` header to every call, the OpenID userinfo endpoint is not
# project-scoped, and the read then returns a null email instead of failing. The
# operator's address comes from `var.operator_member` instead, which also works
# when you drive this lab as a service account rather than as a user.
