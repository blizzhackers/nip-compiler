/// <reference types="vite/client" />

declare module '*.nip?raw' {
  const content: string;
  export default content;
}
