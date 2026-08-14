import build_pyc


def pytest_configure(config):
    build_pyc.main()
