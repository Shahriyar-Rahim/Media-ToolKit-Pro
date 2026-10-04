Put the backend's ENTITLEMENT_PUBLIC_KEY (PEM) in entitlement-public.pem here before packaging.
It is a PUBLIC key: it can only verify signatures, never create them. Without it, offline mode is disabled (online use still works).
Set the API address with MTP_API_URL (default http://localhost:4000); packaged builds should use your https URL.
