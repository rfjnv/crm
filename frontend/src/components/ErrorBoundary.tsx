import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Без этого любое исключение при рендере (особенно в Telegram WebView, где
 * часто нет доступа к консоли) размонтирует всё дерево React и оставляет
 * полностью пустой экран без единого намёка на причину.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <Result
            status="error"
            title="Что-то пошло не так"
            subTitle={this.state.error.message}
            extra={
              <Button type="primary" onClick={this.handleReload}>
                Обновить страницу
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
