import yaml
import pytest
from orchestrator import stand


def test_pick_backup():
    assert stand.pick_backup(['datacore-2026-11-01_055351.tgz', 'datacore-2026-11-02_030715.tgz', 'x.tgz.part']) == 'datacore-2026-11-02_030715.tgz'
    assert stand.pick_backup(['pull.log']) is None


def test_safe_stand_passes():
    ctx = stand.context()
    stand.assert_stand_safe(ctx['db'], stand.render(ctx=ctx), ctx['project'], ctx['owner'])
    assert ctx['db'].endswith('-night')
    assert stand.context()['project'] != ctx['project']


@pytest.mark.parametrize('project', ['dcnight', 'nightshift', 'nightshift-mongo', 'nsqa-short', '', None])
def test_unknown_project_refused(project):
    with pytest.raises(stand.StandError):
        stand.assert_stand_safe('datacore-night', 'networks: {}', project, 'bad')


@pytest.mark.parametrize('mutation', ['external', 'port', 'env_file', 'mongo', 'host_network', 'unknown_owner', 'second_network'])
def test_unsafe_compose_refused(mutation):
    ctx = stand.context()
    data = yaml.safe_load(stand.render(ctx=ctx))
    if mutation == 'external':
        data['networks']['isolated']['internal'] = False
    elif mutation == 'port':
        data['services']['app']['ports'] = ['127.0.0.1:3001:3000']
    elif mutation == 'env_file':
        data['services']['app']['env_file'] = ['.env.stand']
    elif mutation == 'mongo':
        data['services']['app']['environment']['MONGO_URI'] = 'mongodb://mongo:27017/datacore'
    elif mutation == 'host_network':
        data['services']['app']['network_mode'] = 'host'
    elif mutation == 'unknown_owner':
        data['volumes']['mongo-data']['labels'][stand.OWNER_LABEL] = 'someone-else'
    else:
        data['services']['app']['networks'].append('default')
    with pytest.raises(stand.StandError):
        stand.assert_stand_safe(ctx['db'], yaml.safe_dump(data), ctx['project'], ctx['owner'])


def test_find_dump(tmp_path):
    (tmp_path / 'mongo-1/datacore').mkdir(parents=True)
    assert stand.find_dump(tmp_path).name == 'datacore'
    (tmp_path / 'mongo-2/datacore').mkdir(parents=True)
    with pytest.raises(stand.StandError):
        stand.find_dump(tmp_path)
