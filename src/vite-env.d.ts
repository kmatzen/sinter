/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GITHUB_CLIENT_ID?: string;
  readonly PACKAGE_VERSION: string;
  readonly BUILD_SHA: string;
  readonly RELEASE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
