declare module '*.PNG' {
    const content: import('next/image').StaticImageData;
    export default content;
}
