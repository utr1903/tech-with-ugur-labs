import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
export const State = Annotation.Root({
	...MessagesAnnotation.spec,
	turnId: Annotation<string>(),
	step: Annotation<number>(),
	tools: Annotation<number>(),
});
