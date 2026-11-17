/** Lists the answers a remote's server functions gave this host's loader. */
export function ServerAnswers({ answers }: { answers: string[] | null }) {
  return (
    <ul className="server-answers" aria-label="Answers from the remote's server">
      {(answers ?? ["The Rsbuild SSR remote's server did not answer."]).map((message) => (
        <li className="remote-server-answer" key={message}>
          {message}
        </li>
      ))}
    </ul>
  );
}
